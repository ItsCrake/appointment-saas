import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";
import { reportWarning } from "@/lib/observability";
import { isSuperAdminEmail, SUPER_ADMIN_ENV } from "@/lib/super-admin";

export type SuperAdmin = {
  id: string;
  email: string;
};

/**
 * The authorisation boundary for `/master`, checked server-side on every page
 * and every action. There is no middleware shortcut: `proxy.ts` only matches
 * `/dashboard` and `/login`, so this function is the *only* thing standing
 * between a signed-in tenant and every other tenant's client list.
 *
 * Redirects rather than 403s, and never says why. Telling an ordinary owner
 * that `/master` exists but is barred is an invitation.
 */
export async function requireSuperAdmin(): Promise<SuperAdmin> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fmaster");

  const email = user.email ?? null;

  if (!isSuperAdminEmail(email, process.env[SUPER_ADMIN_ENV])) {
    // Worth a log line: a signed-in user reaching /master is either a
    // misconfigured roster or someone probing. `reportWarning` redacts the
    // address itself — the user id is enough to identify them.
    reportWarning("master.denied", "non-admin reached /master", {
      userId: user.id,
    });
    redirect("/dashboard");
  }

  return { id: user.id, email: email as string };
}

/**
 * Non-redirecting variant for callers that need to branch rather than bounce —
 * `requireBusiness()` uses it to decide whether an impersonation cookie may be
 * honoured.
 */
export async function currentSuperAdmin(): Promise<SuperAdmin | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const email = user.email ?? null;
  if (!isSuperAdminEmail(email, process.env[SUPER_ADMIN_ENV])) return null;

  return { id: user.id, email: email as string };
}
