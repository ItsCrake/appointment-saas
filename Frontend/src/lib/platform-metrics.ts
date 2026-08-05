import { PRICING_TIERS, type PlanType, type SubscriptionStatus } from "./plans";

/**
 * Pure platform maths for `/master`. No IO, so every number the console shows
 * is unit-testable — which matters more here than elsewhere, because these are
 * the figures a business decision would be made on.
 */

export type TenantRow = {
  planType: PlanType;
  subscriptionStatus: SubscriptionStatus;
  isActive: boolean;
};

export type TenantBreakdown = {
  total: number;
  /** Active subscription and not frozen. */
  active: number;
  trialing: number;
  /** `is_active = false` — frozen by an admin or by the billing sweep. */
  frozen: number;
  /**
   * In the non-payment grace window: degraded, still serving, not yet frozen.
   *
   * Its own bucket rather than folded into `cancelled`, because these are the
   * tenants still worth chasing. Counting them as churn would overstate it and
   * point the recovery effort at exactly the wrong list.
   */
  pastDue: number;
  cancelled: number;
};

export function breakdownTenants(rows: TenantRow[]): TenantBreakdown {
  const breakdown: TenantBreakdown = {
    total: rows.length,
    active: 0,
    trialing: 0,
    frozen: 0,
    pastDue: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    // Frozen wins over subscription state: a frozen account is not serving
    // anyone, so counting it as "active" would overstate the platform.
    if (!row.isActive) {
      breakdown.frozen += 1;
      continue;
    }
    if (row.subscriptionStatus === "active") breakdown.active += 1;
    else if (row.subscriptionStatus === "trialing") breakdown.trialing += 1;
    else if (row.subscriptionStatus === "past_due") breakdown.pastDue += 1;
    else breakdown.cancelled += 1;
  }

  return breakdown;
}

const MONTHLY_BY_PLAN: Record<PlanType, number> = {
  free: 0,
  starter: PRICING_TIERS.find((t) => t.id === "starter")?.monthlyCents ?? 0,
  pro: PRICING_TIERS.find((t) => t.id === "pro")?.monthlyCents ?? 0,
};

/**
 * Committed monthly revenue, in agorot: only tenants that are both actively
 * subscribed and not frozen.
 *
 * Nothing bills yet — there is no payment provider — so this is what the
 * current roster *would* invoice, not money received. `/master` labels it that
 * way; do not let it become "revenue" anywhere in the UI.
 */
export function monthlyRecurringCents(rows: TenantRow[]): number {
  return rows.reduce((sum, row) => {
    if (!row.isActive || row.subscriptionStatus !== "active") return sum;
    return sum + MONTHLY_BY_PLAN[row.planType];
  }, 0);
}

/** What the trial cohort would add if every one of them converted. */
export function trialPipelineCents(rows: TenantRow[]): number {
  return rows.reduce((sum, row) => {
    if (!row.isActive || row.subscriptionStatus !== "trialing") return sum;
    return sum + MONTHLY_BY_PLAN[row.planType];
  }, 0);
}

/**
 * Share of tenants that ever left a trial and became active.
 *
 * Denominator is active + cancelled, never the trialing cohort: an account
 * still inside its trial has not failed to convert, it simply has not decided.
 * Counting it as a failure makes a growing platform look like a collapsing
 * one. Returns null when nobody has decided yet, so the UI shows "—" rather
 * than a confident 0%.
 *
 * `past_due` is excluded for the same reason: a tenant inside the grace window
 * is mid-decision, and most of them are one card update away from active.
 */
export function trialConversionPercent(rows: TenantRow[]): number | null {
  let converted = 0;
  let decided = 0;

  for (const row of rows) {
    if (row.subscriptionStatus === "active") {
      converted += 1;
      decided += 1;
    } else if (row.subscriptionStatus === "cancelled") {
      decided += 1;
    }
  }

  if (decided === 0) return null;
  return Math.round((converted / decided) * 100);
}

/** Whole days until a trial ends; negative once it has lapsed. */
export function daysUntil(target: Date | null, now: Date): number | null {
  if (!target) return null;
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

/** Trials inside the warning window, soonest first. Lapsed ones are excluded. */
export function expiringTrials<T extends { trialEndsAt: Date | null }>(
  rows: T[],
  now: Date,
  withinHours = 48,
): T[] {
  const limit = now.getTime() + withinHours * 3_600_000;

  return rows
    .filter((row) => {
      if (!row.trialEndsAt) return false;
      const at = row.trialEndsAt.getTime();
      return at >= now.getTime() && at <= limit;
    })
    .sort((a, b) => a.trialEndsAt!.getTime() - b.trialEndsAt!.getTime());
}
