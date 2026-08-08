import type { AuthResult } from "@/app/login/actions";

/**
 * The last line of defence between a broken Server Action and the reader.
 *
 * The three server-side fixes — a lazily-connected database, a deadline on the
 * rate-limit guard, `typedFailure` around every action — all assume the action
 * *ran*. Some failures happen outside it entirely: a cold start that times out,
 * a deploy that lands mid-session and invalidates the action id, a platform
 * error page. In every one of those the browser receives HTML where it expected
 * the action's serialised reply, and the call rejects with
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — a string that has
 * no meaning to a business owner trying to sign up.
 *
 * Nothing on the server can catch that, because the server is what failed. So
 * the caller catches it and says something a person can act on.
 *
 * Deliberately narrow: it wraps one awaited action call and returns the same
 * `AuthResult` shape the action would have. It is not a general error boundary
 * and must not grow into one — swallowing render errors here would hide real
 * bugs behind a polite message.
 */
export async function callAuthAction(
  run: () => Promise<AuthResult>,
): Promise<AuthResult> {
  try {
    return await run();
  } catch (thrown) {
    // Not reported to the server: the server is the thing that just failed to
    // answer, so a second request is unlikely to land and would double the load
    // on whatever is already struggling. The browser console keeps the detail.
    console.error("auth action failed", thrown);

    return {
      ok: false,
      error:
        "לא הצלחנו להשלים את הפעולה — ייתכן שהחיבור נקטע. " +
        "רעננו את הדף ונסו שוב.",
    };
  }
}
