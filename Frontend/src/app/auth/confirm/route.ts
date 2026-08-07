import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { reportWarning } from "@/lib/observability";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const next = safeRedirectPath(params.get("next"), "/login/reset");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login/forgot?error=unconfigured");

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
    redirect("/login/forgot?error=link");
  }

  // Outside the branch above so it is never caught by an error path: redirect()
  // signals by throwing, and the session cookies written by the exchange are
  // flushed onto that response.
  redirect(next);
}
