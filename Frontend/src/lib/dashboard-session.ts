import { redirect } from "next/navigation";

import { db } from "@/db";
import { getBusinessByOwner } from "@/db/queries";
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

  const business = await getBusinessByOwner(db, user.id);
  if (!business) redirect("/dashboard/setup");

  // A business row exists but the owner never finished setup — most likely
  // they closed the tab mid-flow. Put them back where they left off.
  if (!business.onboardingCompletedAt) redirect("/dashboard/setup");

  return { user, business };
}

/**
 * For the onboarding routes themselves: resolves the business without the
 * completion check, so the flow does not redirect to itself.
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
