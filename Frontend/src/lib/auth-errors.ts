/**
 * Reading Supabase Auth's rejections.
 *
 * A separate module rather than a helper inside `login/actions.ts` for a hard
 * reason: **a `"use server"` file may only export async functions.** Exporting a
 * plain predicate from there breaks the entire module at runtime — which is the
 * same class of failure as the one this whole pass is fixing, and it would look
 * identical from the browser.
 */

export type SupabaseAuthError = {
  status?: number;
  code?: string;
  message?: string;
};

/**
 * Whether Supabase refused because of *its* throttle rather than the request.
 *
 * Matched on status and code first. The message is a last resort because it is
 * English prose Supabase is free to reword — "For security purposes, you can
 * only request this after 41 seconds" — and older versions answered 400 with no
 * code at all. Matching prose alone would silently stop working after an
 * upgrade, in a direction that reintroduces the silent failure.
 */
export function isRateLimited(error: SupabaseAuthError): boolean {
  if (error.status === 429) return true;
  if (
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  ) {
    return true;
  }
  return /rate limit|only request this after|too many/i.test(
    error.message ?? "",
  );
}

/**
 * A message worth showing somebody, or null.
 *
 * ---------------------------------------------------------------------------
 * **`{}` is a real message Supabase's client produces**, and it is what an
 * owner photographed and sent us from the sign-up form. From auth-js 2.108 the
 * client treats *every* 5xx — 500 included — as a transport failure: it throws
 * `AuthRetryableFetchError` built from `JSON.stringify(response)` without
 * reading the body, and a `Response` has no enumerable own properties, so the
 * message is the two characters `{}`. The server's actual sentence, "Error
 * sending confirmation email", never reaches the client at all.
 *
 * So a message is only useful once these are ruled out. What the server really
 * said is recovered separately — see `readGotrueBody`.
 * ---------------------------------------------------------------------------
 */
export function usableMessage(message?: string | null): string | null {
  const text = message?.trim();
  if (!text) return null;
  return text === "{}" || text === "[object Object]" ? null : text;
}

/**
 * Whether **Supabase's server** failed, rather than rejecting the request.
 *
 * A 5xx says nothing about the address or the password: the account was not
 * created, and trying the same details again in a minute is the right advice.
 * Status is the whole signal — the message at this point is `{}`.
 */
export function isServerFailure(error: SupabaseAuthError): boolean {
  return typeof error.status === "number" && error.status >= 500;
}

/** What GoTrue put in the body its client threw away. */
export type GotrueFailure = { message: string | null; code: string | null };

/**
 * Reads that body back.
 *
 * GoTrue answers a failure with `{"code":"unexpected_failure","msg":"Error
 * sending confirmation email"}` or the older `error`/`error_description` pair.
 * Anything that is not JSON — a gateway's HTML page, an empty 502 — leaves
 * both fields null, which is honest: there was nothing to read.
 */
export function readGotrueBody(body?: string | null): GotrueFailure {
  if (!body?.trim()) return { message: null, code: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { message: null, code: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { message: null, code: null };
  }

  const fields = parsed as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  return {
    message: pick("msg", "message", "error_description", "error"),
    code: pick("code", "error_code"),
  };
}

/**
 * Whether the thing that failed was **sending the email**.
 *
 * Worth telling apart from every other 500 because it is the one an owner can
 * be told something true about — the account was not created, nothing they
 * typed is at fault, and it will keep failing until the project's SMTP is
 * fixed. GoTrue creates the user and sends the confirmation inside one
 * transaction, so a failed send rolls the account back.
 */
export function isEmailSendFailure(failure: GotrueFailure): boolean {
  if (failure.code === "email_provider_disabled") return true;
  return /sending .*(?:email|mail)|smtp|mailer/i.test(failure.message ?? "");
}

/**
 * Whether the address is already registered.
 *
 * Supabase answers this two ways depending on whether the project has
 * enumeration protection on, and **both have to be handled or a duplicate
 * sign-up looks like a success**: with protection on it returns 200 and a user
 * whose `identities` array is empty; with it off it returns a 422 saying so.
 */
export function isAlreadyRegistered(error: SupabaseAuthError): boolean {
  if (error.code === "user_already_exists" || error.code === "email_exists") {
    return true;
  }
  return /already registered|already exists/i.test(error.message ?? "");
}
