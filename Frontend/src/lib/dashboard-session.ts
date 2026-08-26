import { cache } from "react";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  claimPendingBusiness,
  getBusinessById,
  getBusinessByOwner,
} from "@/db/queries";
import { reportWarning } from "@/lib/observability";
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
 * The business this account owns, claiming one that was waiting for it (0028).
 *
 * ---------------------------------------------------------------------------
 * **The binding completes on the owner's first authenticated request**, not on
 * a link they have to find in an email. The operator sets a shop up and names
 * the address; the person signs in however they like — password, reset link,
 * magic link — and the shop is simply theirs.
 *
 * The lookup runs **only when they own nothing yet**, which makes it free for
 * every established tenant: one indexed miss on the account's own row, then
 * nothing. A platform of ten thousand shops pays for this on the handful of
 * requests where somebody genuinely has no business.
 *
 * `claimPendingBusiness` settles the race in its WHERE clause rather than
 * here, so two tabs racing a first login cannot both claim the shop.
 *
 * Wrapped in `cache` per request like the lookup it wraps: several pages and
 * actions resolve the session in one render, and the claim must not be
 * attempted repeatedly within a single request.
 * ---------------------------------------------------------------------------
 */
export const businessForOwnerOrClaim = cache(
  async (user: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
  }) => {
    const existing = await businessForOwner(user.id);
    if (existing) return existing;

    const email = user.email ?? null;
    if (!email) return null;

    /**
     * **The address has to be proven, not merely typed.**
     *
     * A claim binds a whole business — its calendar, its clients, its
     * phone numbers — to whoever signs in with a matching address. Without
     * this check the only thing standing between an attacker and a pilot
     * shop is knowing the owner's email, which is usually printed on the
     * shop's own door: sign up as `owner@shop.com`, and the business is
     * yours the moment the dashboard loads.
     *
     * Supabase *does* gate sign-in on confirmation when the project has
     * "Confirm email" enabled — but that is a toggle in a dashboard this
     * repository cannot see, cannot test, and does not control. Making the
     * claim depend on it would mean a single unrelated setting change
     * silently turns tenant takeover on. So the guarantee is asserted here,
     * where it is visible and tested, and the project setting becomes
     * defence in depth rather than the defence.
     *
     * An unconfirmed user simply owns nothing yet. They are sent to the
     * setup wizard like any other new account, and their shop is still
     * waiting the next time they sign in — this refuses the claim, it does
     * not consume it.
     */
    if (!user.email_confirmed_at) {
      reportWarning(
        "onboarding.claimRefused",
        "unconfirmed address attempted a pending-business claim",
        { userId: user.id },
      );
      return null;
    }

    const claimed = await claimPendingBusiness(db, user.id, email);
    if (claimed) {
      reportWarning("onboarding.claimed", "pending business bound to owner", {
        businessId: claimed.id,
        userId: user.id,
      });
    }

    return claimed;
  },
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

  const business = await businessForOwnerOrClaim(user);
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

  /**
   * Claims here too, not only in `requireBusiness` (0028).
   *
   * An invited owner whose first authenticated page is the wizard — a bookmark,
   * a `?next=` on the login form, or simply the redirect from a dashboard they
   * do not yet own — would otherwise be handed the "create your business" flow
   * while their shop sat waiting three feet away, and would end up with two.
   */
  const business = await businessForOwnerOrClaim(user);
  return { user, business };
}

/** Same session check without the business requirement, for the setup page. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
