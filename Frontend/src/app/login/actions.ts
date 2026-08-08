"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { db } from "@/db";
import {
  authRedirectOrigin,
  configuredAppUrl,
  originFromHeaders,
} from "@/lib/app-url";
import { isAlreadyRegistered, isRateLimited } from "@/lib/auth-errors";
import {
  authIdentifier,
  newPasswordSchema,
  resetRequestSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth-validation";
import { reportError, reportWarning } from "@/lib/observability";
import { AUTH_RULES, rateLimitMessage } from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { getClientIp } from "@/lib/request-context";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Supabase errors are not guaranteed to carry a usable `message` — a transport
 * failure or an unusual status can leave it empty, which previously reached the
 * form as a blank alert with nothing to act on. Always produce something the
 * reader can search for.
 */
function describeAuthError(error: { message?: string; status?: number }) {
  const message = error.message?.trim();
  if (message) return message;
  return error.status
    ? `שגיאת אימות (HTTP ${error.status}). בדקו את יומן Supabase Auth.`
    : "שגיאת אימות ללא פירוט. בדקו את יומן Supabase Auth.";
}

/**
 * The error's *class* is the fastest way to tell what failed, and it is not in
 * the message: `AuthApiError` means Supabase replied with a structured
 * rejection, while `AuthRetryableFetchError` means the request never came back
 * with a usable response at all (status 0) — a transport failure, not a
 * credentials one. Logged as `errorClass` rather than `name`, because
 * observability redacts any context key matching /name/.
 */
function reportAuthFailure(scope: string, thrown: unknown) {
  const error = thrown as { name?: string; status?: number; code?: string };
  reportError(scope, thrown, {
    errorClass: error?.name ?? null,
    status: error?.status ?? null,
    code: error?.code ?? null,
  });
}

/** A transport failure is worth retrying; a rejected credential is not. */
const TRANSPORT_FAILURE =
  "לא הצלחנו להגיע לשרת ההזדהות של Supabase. נסו שוב בעוד רגע.";

export type AuthResult =
  | { ok: false; error: string; rateLimited?: true }
  | { ok: true; message?: string };

/** What a reader is told when something failed that we did not anticipate. */
const UNEXPECTED_FAILURE =
  "משהו השתבש אצלנו. נסו שוב בעוד רגע, ואם זה חוזר — כתבו לנו.";

/**
 * One sentence for both shapes of "this address already has an account", so the
 * reader cannot tell which project setting is in force — and, more usefully,
 * gets pointed at the two things that actually help.
 */
const ALREADY_REGISTERED =
  "כתובת האימייל כבר רשומה במערכת. התחברו עם הסיסמה הקיימת, או אפסו אותה.";

/**
 * Turns any unhandled throw into a typed `AuthResult`.
 *
 * A Server Action that throws does not return a result the caller can read, and
 * the reply the browser gets instead is not the action's — it is whatever the
 * platform serves for a crashed function, which is HTML. The client is parsing
 * the action's serialised reply, so it reports
 * `Unexpected token '<', "<!DOCTYPE "`, which tells the reader nothing and told
 * us nothing either.
 *
 * **`unstable_rethrow` first, always.** `redirect()` signals success by
 * throwing a `NEXT_REDIRECT` error, so a plain `catch` here would swallow every
 * successful sign-in and turn it into "something went wrong" — the exact bug a
 * blanket try/catch around these actions would introduce. This lets the
 * framework's own control-flow errors through untouched and keeps only the
 * genuine ones.
 *
 * This is the *last* line, not the only one: `@/db` no longer throws at import,
 * which is what made the module unloadable in the first place, and the forms
 * catch a failed action call on the client for the case where the function
 * never runs at all.
 */
async function typedFailure(
  scope: string,
  run: () => Promise<AuthResult>,
): Promise<AuthResult> {
  try {
    return await run();
  } catch (thrown) {
    unstable_rethrow(thrown);
    reportAuthFailure(scope, thrown);
    return { ok: false, error: UNEXPECTED_FAILURE };
  }
}

/**
 * Brute-force guard for the credential endpoints.
 *
 * Server Actions are not HTTP handlers, so there is no status line to set —
 * the "429" lives in the payload as `rateLimited`, and the caller renders it.
 * The route handlers that *do* return a status use the same rules.
 *
 * Fails **open**, like the booking guard: a counter table that is unreachable
 * must not be able to lock every customer out of their own account.
 */
async function guardAuth(
  rules: {
    rule: (typeof AUTH_RULES)[keyof typeof AUTH_RULES];
    identifier: string;
  }[],
  scope: string,
): Promise<AuthResult | null> {
  const result = await enforceRateLimits(db, rules);
  if (result.allowed) return null;

  reportWarning(scope, "auth rate limit tripped", {
    rule: result.rule.scope,
    retryAfterSeconds: result.decision.retryAfterSeconds,
  });

  return {
    ok: false,
    rateLimited: true,
    error: rateLimitMessage(result.decision),
  };
}

async function signIn(
  email: string,
  password: string,
  next?: string,
): Promise<AuthResult> {
  const parsed = signInSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  // Counted before the credentials are checked, so a wrong guess costs the
  // attacker budget whether or not the account exists.
  const limited = await guardAuth(
    [
      { rule: AUTH_RULES.signInIp, identifier: await getClientIp() },
      {
        rule: AUTH_RULES.signInIdentity,
        identifier: authIdentifier(parsed.data.email),
      },
    ],
    "auth.signIn.ratelimit",
  );
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "התחברות אינה מוגדרת. חסרים מפתחות Supabase." };
  }

  const result = await supabase.auth
    .signInWithPassword(parsed.data)
    .catch((thrown: unknown) => {
      // A transport failure rejects rather than returning an error object.
      reportAuthFailure("auth.signIn", thrown);
      return null;
    });

  if (!result) {
    return { ok: false, error: TRANSPORT_FAILURE };
  }

  if (result.error) {
    // The reader gets a deliberately vague message — distinguishing the two
    // leaks which emails exist — but the log keeps the real cause.
    reportAuthFailure("auth.signIn", result.error);
    return { ok: false, error: "אימייל או סיסמה שגויים" };
  }

  // Narrowed to the dashboard: sign-in only ever returns someone to where the
  // proxy bounced them from, so anything wider is more than the feature needs.
  redirect(safeRedirectPath(next, "/dashboard", "/dashboard"));
}

async function signUp(email: string, password: string): Promise<AuthResult> {
  // The strict schema: strength is enforced when a password is *chosen*, never
  // when it is used. See `lib/auth-validation.ts`.
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const limited = await guardAuth(
    [{ rule: AUTH_RULES.signUpIp, identifier: await getClientIp() }],
    "auth.signUp.ratelimit",
  );
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "הרשמה אינה מוגדרת. חסרים מפתחות Supabase." };
  }

  const result = await supabase.auth
    .signUp(parsed.data)
    .catch((thrown: unknown) => {
      reportAuthFailure("auth.signUp", thrown);
      return null;
    });

  if (!result) {
    return { ok: false, error: TRANSPORT_FAILURE };
  }

  if (result.error) {
    reportAuthFailure("auth.signUp", result.error);

    // The duplicate-email case, second of the two shapes Supabase uses for it
    // (the other is below). Which one arrives depends on a project setting, so
    // both are handled or a re-registration reads as an unexplained failure.
    if (isAlreadyRegistered(result.error)) {
      return { ok: false, error: ALREADY_REGISTERED };
    }

    if (isRateLimited(result.error)) {
      return {
        ok: false,
        rateLimited: true,
        error: "יותר מדי נסיונות הרשמה. נסו שוב בעוד כמה דקות.",
      };
    }

    // `describeAuthError` returns Supabase's own English text, which is fine
    // for a genuinely unexpected rejection an owner will quote to us, and is
    // why the recognised cases above are handled before it.
    return { ok: false, error: describeAuthError(result.error) };
  }

  const { data } = result;

  // Supabase's user-enumeration defence: signing up with an address that is
  // already registered returns success with an *empty* identities array and no
  // error. Without this branch it falls through to "check your inbox" — an
  // email that never arrives, for an account that already exists.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { ok: false, error: ALREADY_REGISTERED };
  }

  // With email confirmation on, Supabase returns a user but no session.
  if (data.user && !data.session) {
    return {
      ok: true,
      message: "נשלח אליכם אימייל לאישור החשבון. אשרו אותו ואז התחברו.",
    };
  }

  redirect("/dashboard");
}

/* -------------------------------------------------------------------------- */
/* Exported actions — every one of them returns, none of them throws.          */
/* -------------------------------------------------------------------------- */

export async function signInAction(
  email: string,
  password: string,
  next?: string,
): Promise<AuthResult> {
  return typedFailure("auth.signIn.unhandled", () =>
    signIn(email, password, next),
  );
}

export async function signUpAction(
  email: string,
  password: string,
): Promise<AuthResult> {
  return typedFailure("auth.signUp.unhandled", () => signUp(email, password));
}

export async function requestPasswordResetAction(
  email: string,
): Promise<AuthResult> {
  return typedFailure("auth.resetRequest.unhandled", () =>
    requestPasswordReset(email),
  );
}

export async function updatePasswordAction(
  password: string,
  confirm: string,
): Promise<AuthResult> {
  return typedFailure("auth.updatePassword.unhandled", () =>
    updatePassword(password, confirm),
  );
}

export async function signOutAction() {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase?.auth.signOut();
  } catch (thrown) {
    unstable_rethrow(thrown);
    // Sign-out is best effort: a failure to reach Supabase must not strand the
    // reader on a page they are trying to leave. The cookie is cleared by the
    // redirect target's own session check either way.
    reportAuthFailure("auth.signOut", thrown);
  }

  redirect("/login");
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The one thing this action ever says.
 *
 * Registered or not, rate-limited by Supabase or not, accepted or rejected —
 * the reader gets this sentence. Anything that varies with whether the address
 * has an account turns a public form into a membership oracle: point it at a
 * list of addresses, read the responses, learn who runs a business here. That
 * is worth more to an attacker than it sounds, because the answer is also a
 * list of people worth phishing with a convincing Bazman email.
 *
 * The cost is real and accepted: someone who mistypes their address is told to
 * check an inbox that will stay empty. The alternative tells strangers the
 * truth about every address they try.
 */
const RESET_SENT_NOTICE =
  "אם קיים חשבון עם הכתובת הזו, שלחנו אליו קישור לאיפוס סיסמה. " +
  "הקישור תקף לשעה אחת. בדקו גם בתיקיית הספאם.";

async function requestPasswordReset(email: string): Promise<AuthResult> {
  const parsed = resetRequestSchema.safeParse({ email });
  // A malformed address is the one thing worth saying plainly: it cannot
  // belong to anybody, so saying so discloses nothing.
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  // Counted before anything is sent, and keyed on a hash of the address — the
  // identity rules are what stop this form being used to bomb someone's inbox.
  //
  // `resetCooldown` is listed first deliberately: it is the tightest, so it is
  // the one a repeat click hits, and it answers identically for a registered
  // and an unregistered address. Reaching Supabase's own per-address throttle
  // instead would produce an answer that only a *real* address can trigger.
  const identity = authIdentifier(parsed.data.email);
  const limited = await guardAuth(
    [
      { rule: AUTH_RULES.resetCooldown, identifier: identity },
      { rule: AUTH_RULES.resetIp, identifier: await getClientIp() },
      { rule: AUTH_RULES.resetIdentity, identifier: identity },
    ],
    "auth.resetRequest.ratelimit",
  );
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      error: "איפוס סיסמה אינו מוגדר. חסרים מפתחות Supabase.",
    };
  }

  // NOT the share-link rule. `authRedirectOrigin` pins this to
  // `NEXT_PUBLIC_APP_URL` and never promotes a request header into an emailed
  // link — see the note on that function for both reasons.
  const requestHeaders = await headers();
  const { origin, fromRequestHeader } = authRedirectOrigin(
    configuredAppUrl(),
    originFromHeaders((name) => requestHeaders.get(name)),
  );

  if (fromRequestHeader) {
    // Only reachable with NEXT_PUBLIC_APP_URL unset, which
    // `check:env --production` refuses to deploy. Worth a line in the log
    // anyway: it is the difference between a working reset and a link that
    // dumps the owner on the home page.
    reportWarning("auth.resetRequest", "NEXT_PUBLIC_APP_URL unset", { origin });
  }

  const result = await supabase.auth
    .resetPasswordForEmail(parsed.data.email, {
      // Unencoded slashes on purpose: they are legal in a query *value*, and
      // this is the string that has to be recognisable in the Supabase
      // Redirect URLs allow-list, which is read and pasted by a human.
      redirectTo: `${origin}/auth/confirm?next=/login/reset`,
    })
    .catch((thrown: unknown) => {
      reportAuthFailure("auth.resetRequest", thrown);
      return null;
    });

  // A transport failure is not an enumeration signal — it says nothing about
  // the address — so it is the one case worth reporting honestly. Claiming an
  // email was sent when the request never reached Supabase would leave the
  // owner waiting on mail that was never going to arrive.
  if (!result) return { ok: false, error: TRANSPORT_FAILURE };

  if (result.error) {
    reportAuthFailure("auth.resetRequest", result.error);

    // **Do not claim an email was sent when Supabase refused to send one.**
    // Returning the cheerful notice here is what made the reported bug silent:
    // the reader was told to check their inbox, no mail ever arrived, and the
    // only record was a log line nobody was reading.
    //
    // Saying so is safe *because* `resetCooldown` runs first. A per-address
    // throttle can only answer for an address that exists, so it would be a
    // disclosure — but that throttle is now unreachable, since our own minute
    // is at least as tight as Supabase's and is spent before the call. What
    // survives to here is the project-wide email cap, which is the same for
    // every address and therefore discloses nothing.
    if (isRateLimited(result.error)) {
      return {
        ok: false,
        rateLimited: true,
        error:
          "מערכת הדיוור עמוסה כרגע ולא הצלחנו לשלוח את הקישור. " +
          "נסו שוב בעוד כמה דקות.",
      };
    }

    // Anything else Supabase rejected — a malformed address it dislikes, a
    // disabled provider, a project misconfiguration. The reader learns the
    // attempt failed without learning anything about the address.
    return {
      ok: false,
      error: "לא הצלחנו לשלוח את הקישור כרגע. נסו שוב בעוד רגע.",
    };
  }

  return { ok: true, message: RESET_SENT_NOTICE };
}

/**
 * Completes the reset. The caller must already hold the session minted by
 * `/auth/confirm` from the emailed link — that link is the credential here,
 * which is why no current password is asked for.
 *
 * Deliberately **not** rate limited: there is nothing to guess. Reaching this
 * action at all requires a valid session, and the budget that guards getting
 * one is spent in `requestPasswordResetAction`. A limit here would only be able
 * to lock a legitimate owner out midway through their own recovery.
 */
async function updatePassword(
  password: string,
  confirm: string,
): Promise<AuthResult> {
  // The strict schema: a password is being *chosen*, so strength applies —
  // the same rule sign-up uses, from the same constant the form renders hints
  // from.
  const parsed = newPasswordSchema.safeParse({ password, confirm });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      error: "איפוס סיסמה אינו מוגדר. חסרים מפתחות Supabase.",
    };
  }

  // getUser(), not getSession(): the identity is revalidated against the auth
  // server rather than trusted from a cookie, exactly as everywhere else.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "הקישור פג או שאינו תקף. בקשו קישור חדש לאיפוס הסיסמה.",
    };
  }

  const result = await supabase.auth
    .updateUser({ password: parsed.data.password })
    .catch((thrown: unknown) => {
      reportAuthFailure("auth.updatePassword", thrown);
      return null;
    });

  if (!result) return { ok: false, error: TRANSPORT_FAILURE };

  if (result.error) {
    reportAuthFailure("auth.updatePassword", result.error);
    // Safe to surface: the reader already holds a session for this account, so
    // there is nothing left to disclose to them about it.
    return { ok: false, error: describeAuthError(result.error) };
  }

  // A reset is the remedy for "somebody may have my password", so it has to
  // evict whoever that was. `others` keeps the session that just did the reset
  // — signing the owner out of their own recovery would be a strange reward
  // for completing it.
  await supabase.auth.signOut({ scope: "others" }).catch((thrown: unknown) => {
    // Best effort. The password is already changed, which is the part that
    // matters; failing the action here would tell the owner it did not work.
    reportAuthFailure("auth.updatePassword.signOutOthers", thrown);
  });

  redirect("/dashboard");
}
