import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

import { reportWarning } from "@/lib/observability";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { hardenCookieOptions } from "@/lib/supabase/cookies";

export const dynamic = "force-dynamic";

/**
 * Where an emailed auth link lands.
 *
 * It exchanges whatever the link carries for a real session cookie, then
 * forwards to the page that needs it. Supabase mints two different link shapes
 * and **both** are handled here, because which one arrives is decided by an
 * email template in the Supabase dashboard rather than by this code:
 *
 * - `token_hash` + `type` → `verifyOtp`. Works on **any device**, because the
 *   token is self-contained.
 * - `code` → `exchangeCodeForSession`. PKCE, and the code verifier lives in a
 *   cookie written when the reset was *requested* — so it only works in the
 *   same browser. Request the reset on a phone, open the mail on a laptop, and
 *   this one cannot succeed.
 *
 * Handling only the PKCE shape is the trap: it works perfectly in development,
 * where request and click happen in one browser, and fails for the very common
 * real case. `docs/DEPLOYMENT.md` covers pointing the template at
 * `{{ .TokenHash }}` so the cross-device shape is what actually gets sent.
 *
 * > **The session cookies are written onto the response this handler returns,
 * > not into the ambient `cookies()` store.** The earlier version built the
 * > client from `next/headers` and signalled the redirect by throwing, which
 * > left the cookie writes depending on the framework flushing a mutated store
 * > onto a thrown redirect. That is an implementation detail to lean on for the
 * > one request that carries a single-use token: if it ever fails to flush, the
 * > token is spent and the owner lands on a page that says the link is invalid,
 * > with no way to tell why. Attaching them to an explicit `NextResponse` is
 * > the documented `@supabase/ssr` route-handler pattern and removes the doubt.
 */

/** Link types this app issues. Anything else is refused rather than relayed. */
const ALLOWED_TYPES = new Set<EmailOtpType>([
  "recovery",
  "signup",
  "email",
  "email_change",
]);

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && ALLOWED_TYPES.has(value as EmailOtpType);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");

  // Never trust the destination from the query — see `lib/safe-redirect.ts`.
  // A link that genuinely signs the victim in and *then* forwards them
  // off-origin is far more convincing than an ordinary phishing link.
  //
  // The default matters as much as the guard: if Supabase drops the `next`
  // parameter (it rewrites `redirect_to` on its way through), the owner still
  // arrives at the reset form rather than somewhere arbitrary.
  const next = safeRedirectPath(params.get("next"), "/login/reset");

  /** Route handlers must return an absolute `Location`. */
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, request.nextUrl.origin));

  const config = getSupabaseConfig();
  if (!config) return redirectTo("/login/forgot?error=unconfigured");

  // Built up front so `setAll` has somewhere to put the session. This is the
  // response returned on success, carrying the cookies with it.
  const success = redirectTo(next);

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // Same hardening as every other writer, so the session minted from a
          // recovery link is no weaker than one minted by signing in.
          success.cookies.set(name, value, hardenCookieOptions(options));
        }
      },
    },
  });

  let failure: string | null = null;

  if (tokenHash && isAllowedType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    failure = error ? error.message : null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failure = error ? error.message : null;
  } else {
    failure = "link carried neither token_hash nor code";
  }

  if (failure) {
    // A warning, not an error: an expired link is the ordinary outcome of
    // waiting an hour, not a fault. The address is not logged — observability
    // redacts it, and there is nothing here worth keeping anyway.
    reportWarning("auth.confirm", "recovery link rejected", {
      reason: failure,
      linkShape: tokenHash ? "token_hash" : code ? "code" : "none",
    });
    // A fresh response, deliberately: whatever partial cookie state the failed
    // exchange wrote onto `success` is dropped rather than carried to a page
    // that would then look half-signed-in.
    return redirectTo("/login/forgot?error=link");
  }

  return success;
}
