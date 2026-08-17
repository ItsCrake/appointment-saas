import { cache } from "react";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { getBusinessById, getBusinessByOwner } from "@/db/queries";
import { readImpersonatedBusinessId } from "@/lib/impersonation";
import { currentSuperAdmin } from "@/lib/master-session";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * What the caller may do with the resolved business.
 *
 * `read-only` is what the non-payment freeze actually means for the owner: the
 * dashboard still renders, their history is still theirs, and every write is
 * refused. The public booking page is already offline via `is_active`.
 */
export type DashboardAccess = "full" | "read-only";

function accessFor(business: { isActive: boolean }): DashboardAccess {
  // Frozen covers both reasons: non-payment and an admin freeze. Neither
  // should be able to write, and `frozen_reason` only decides who may thaw it.
  return business.isActive ? "full" : "read-only";
}

/**
 * The owner's business, resolved once per request.
 *
 * The layout's freeze banner and the page's `requireBusiness()` both need this
 * row, and before this they each queried for it — two identical lookups on
 * every navigation and every server action. Shared here so the layout and the
 * page it wraps agree by construction as well as by cost.
 *
 * Per-request only, like `getCurrentUser`: a freeze applied between two
 * requests is still seen on the next one.
 */
export const businessForOwner = cache(async (userId: string) =>
  getBusinessByOwner(db, userId),
);

/**
 * Resolves the owner's business for every dashboard page and action.
 *
 * This is the real authorisation boundary — middleware only redirects. Actions
 * take the business id from *here*, never from the request body, so a crafted
 * payload cannot touch another tenant.
 *
 * Reads are allowed while frozen; `requireWritable()` below is what every
 * mutating action must call instead.
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
        return {
          user,
          business: target,
          impersonating: true as const,
          // Deliberately the tenant's own access level, not an elevated one.
          // An admin cannot write to a frozen tenant either: the freeze is
          // about the account's state, not about who is looking at it.
          access: accessFor(target),
        };
      }
    }
  }

  const business = await businessForOwner(user.id);
  if (!business) redirect("/dashboard/setup");

  // A business row exists but the owner never finished setup — most likely
  // they closed the tab mid-flow. Put them back where they left off.
  if (!business.onboardingCompletedAt) redirect("/dashboard/setup");

  return {
    user,
    business,
    impersonating: false as const,
    access: accessFor(business),
  };
}

/**
 * The write gate. **Every mutating dashboard action must call this instead of
 * `requireBusiness()`**, and `dashboard-session.coverage.test.ts` fails the
 * build if one forgets.
 *
 * That test is the point. ARCHITECTURE.md warned that a per-action gate with
 * partial coverage is worse than none, because it *looks* safe — so the
 * coverage is checked mechanically rather than trusted to review.
 *
 * Redirects rather than throwing. A frozen owner with a stale tab open clicks
 * Save and lands back on the dashboard, where the banner explains why, instead
 * of seeing an unhandled server error. Still fail-closed: the action's body
 * never runs.
 */
export async function requireWritable() {
  const session = await requireBusiness();
  if (session.access !== "full") redirect("/dashboard?frozen=1");
  return session;
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

  const business = await businessForOwner(user.id);
  return { user, business };
}

/** Same session check without the business requirement, for the setup page. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
