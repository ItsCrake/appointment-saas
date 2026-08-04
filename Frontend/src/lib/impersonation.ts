import { cookies } from "next/headers";

/**
 * Support impersonation for `/master`.
 *
 * The cookie holds nothing but a business id, and it is **not** trusted on its
 * own: `requireBusiness()` re-checks that the caller is a super admin on every
 * single request before honouring it. A forged or stolen cookie is therefore
 * inert without a live super-admin session — which is the whole security
 * argument for this design.
 *
 * The alternative — minting a real Supabase session for the target owner via
 * the admin API — was rejected. It would make the admin indistinguishable from
 * the tenant in Supabase's own auth logs, and a leaked token would be a
 * standalone credential for that account. Here the admin keeps their own
 * identity throughout.
 *
 * ⚠️ Impersonation is **not read-only**. `requireBusiness()` is the single
 * boundary every dashboard action shares, so an impersonating admin can write
 * as the tenant, and those writes are indistinguishable from the owner's in
 * the data. The banner and the audit log are the mitigations; enforcing
 * read-only needs a per-action gate and is a deliberate follow-up.
 */
export const IMPERSONATION_COOKIE = "bazman_impersonate";

/** Short by design: a support session should expire before it is forgotten. */
const MAX_AGE_SECONDS = 60 * 60;

export async function readImpersonatedBusinessId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(IMPERSONATION_COOKIE)?.value?.trim();
  return value ? value : null;
}

export async function setImpersonation(businessId: string): Promise<void> {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearImpersonation(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}
