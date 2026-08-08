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
