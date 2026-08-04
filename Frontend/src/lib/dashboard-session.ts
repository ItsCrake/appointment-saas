import { redirect } from "next/navigation";

import { db } from "@/db";
import { getBusinessById, getBusinessByOwner } from "@/db/queries";
import { readImpersonatedBusinessId } from "@/lib/impersonation";
import { currentSuperAdmin } from "@/lib/master-session";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Resolves the owner's business for every dashboard page and action.
 *
 * This is the real authorisation boundary — middleware only redirects. Actions
 * take the business id from *here*, never from the request body, so a crafted
 * payload cannot touch another tenant.
 */
export async function requireBusiness() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Support impersonation, from /master. The cookie is worthless on its own:
  // the super-admin check runs here, on every request, before it is honoured.
  // Anyone who steals or forges it still resolves to their own business.
  const impersonatedId = await readImpersonatedBusinessId();
  if (impersonatedId) {
    const admin = await currentSuperAdmin();
    if (admin) {
      const target = await getBusinessById(db, impersonatedId);
      if (target) {
        return { user, business: target, impersonating: true as const };
      }
    }
  }

  const business = await getBusinessByOwner(db, user.id);
  if (!business) redirect("/dashboard/setup");

  // A business row exists but the owner never finished setup — most likely
  // they closed the tab mid-flow. Put them back where they left off.
  if (!business.onboardingCompletedAt) redirect("/dashboard/setup");

  return { user, business, impersonating: false as const };
}

/**
 * For the onboarding routes themselves: resolves the business without the
 * completion check, so the flow does not redirect to itself.
 *
 * Deliberately ignores impersonation — an admin has no business walking
 * another owner through their own setup wizard.
 */
export async function requireBusinessForSetup() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const business = await getBusinessByOwner(db, user.id);
  return { user, business };
}

/** Same session check without the business requirement, for the setup page. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
