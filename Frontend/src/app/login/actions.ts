"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  authIdentifier,
  signInSchema,
  signUpSchema,
} from "@/lib/auth-validation";
import { reportError, reportWarning } from "@/lib/observability";
import { AUTH_RULES, rateLimitMessage } from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { getClientIp } from "@/lib/request-context";
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

export async function signInAction(
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

  redirect(next && next.startsWith("/dashboard") ? next : "/dashboard");
}

export async function signUpAction(
  email: string,
  password: string,
): Promise<AuthResult> {
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
    return { ok: false, error: describeAuthError(result.error) };
  }

  const { data } = result;

  // Supabase's user-enumeration defence: signing up with an address that is
  // already registered returns success with an *empty* identities array and no
  // error. Without this branch it falls through to "check your inbox" — an
  // email that never arrives, for an account that already exists.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return {
      ok: false,
      error: "כתובת האימייל כבר רשומה. התחברו או אפסו סיסמה.",
    };
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

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect("/login");
}
