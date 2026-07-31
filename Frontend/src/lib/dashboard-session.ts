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

  return { user, business };
}

/** Same session check without the business requirement, for the setup page. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
