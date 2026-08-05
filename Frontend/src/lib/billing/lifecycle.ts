import type { SubscriptionStatus } from "@/lib/plans";

/**
 * The subscription state machine, as pure functions over a row and a clock.
 *
 * No IO and no database handle, for the same reason `platform-metrics.ts` has
 * none: these decide whether a paying customer keeps their booking page, and
 * that is not a thing to verify by running the cron and watching.
 *
 *   trialing --(trial lapses)--> past_due --(7 days)--> frozen
 *      |                            |
 *      +--------(pays)-------> active <--(pays)--+
 *
 * Freezing is deliberately the *last* step, never the first. A tenant whose
 * card expired still has clients holding a link to their booking page, and
 * taking that offline on day one punishes the clients for the owner's billing
 * problem. Seven days of degraded service first, then the page goes dark.
 */

/** Days of degraded service before a non-paying tenant is frozen. */
export const GRACE_DAYS = 7;

/**
 * Warn at 3 days out, then again at 1.
 *
 * Each threshold fires only inside its own band (see `trialWarningThreshold`),
 * so a cron run that never happened cannot cause both to arrive together on
 * the same morning. Two warnings in one inbox reads as a broken system, which
 * is the opposite of what a trial-ending notice is for.
 */
export const TRIAL_WARNING_DAYS = [3, 1] as const;

export type LifecycleRow = {
  id: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  graceStartedAt: Date | null;
  isActive: boolean;
  frozenReason: string | null;
};

export type LifecycleAction =
  /** Trial ends soon. Nothing changes; the owner gets a heads-up. */
  | { type: "warn_trial"; threshold: number; daysLeft: number }
  /** Trial lapsed: drop to `past_due` and start the grace clock. */
  | { type: "start_grace" }
  /** Grace exhausted: take the public page offline. */
  | { type: "freeze" }
  | { type: "none" };

const DAY_MS = 86_400_000;

/**
 * Whole days until a date; 0 or negative once it has passed.
 *
 * `Math.ceil` returns `-0` for any moment in the last day, which is equal to 0
 * but not identical to it. Normalised here rather than at each call site: it
 * would otherwise reach copy as "-0 ימים" and read as a broken system.
 */
export function daysUntil(target: Date, now: Date): number {
  const days = Math.ceil((target.getTime() - now.getTime()) / DAY_MS);
  return days === 0 ? 0 : days;
}

/**
 * Which warning band a trial is in, or null if it is in none.
 *
 * Bands are half-open and non-overlapping: 3 covers `1 < daysLeft <= 3`, and 1
 * covers `0 < daysLeft <= 1`. That is what makes a missed cron run degrade to
 * *one late warning* rather than two simultaneous ones.
 */
export function trialWarningThreshold(daysLeft: number): number | null {
  if (daysLeft <= 0) return null;

  const sorted = [...TRIAL_WARNING_DAYS].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const upper = sorted[i];
    const lower = i === 0 ? 0 : sorted[i - 1];
    if (daysLeft > lower && daysLeft <= upper) return upper;
  }

  return null;
}

/**
 * The single decision function. One action per tenant per run: a tenant whose
 * trial lapsed today starts grace now and is considered for freezing on a
 * later run, never both in the same pass.
 */
export function planTransition(row: LifecycleRow, now: Date): LifecycleAction {
  // Already frozen. Nothing to do until a payment arrives, which is the
  // provider webhook's job rather than the sweep's.
  if (!row.isActive) return { type: "none" };

  if (row.subscriptionStatus === "trialing") {
    if (!row.trialEndsAt) return { type: "none" };

    const left = daysUntil(row.trialEndsAt, now);
    if (left <= 0) return { type: "start_grace" };

    const threshold = trialWarningThreshold(left);
    return threshold === null
      ? { type: "none" }
      : { type: "warn_trial", threshold, daysLeft: left };
  }

  if (row.subscriptionStatus === "past_due") {
    // No clock means the status was set by hand or by a provider event that
    // did not start one. Freezing on an unknown clock would be a guess, and
    // the guess costs a tenant their booking page.
    if (!row.graceStartedAt) return { type: "none" };

    const elapsed = now.getTime() - row.graceStartedAt.getTime();
    if (elapsed >= GRACE_DAYS * DAY_MS) return { type: "freeze" };
    return { type: "none" };
  }

  // `active` and `cancelled` are both terminal as far as the clock is
  // concerned. A cancellation that should freeze arrives as a provider event.
  return { type: "none" };
}

/**
 * Whether a recovered payment may lift an existing freeze.
 *
 * Only billing froze it, only billing may thaw it. An admin freeze is a
 * deliberate act — abuse, a legal hold, a support decision — and letting a
 * successful charge undo it would hand the tenant a way to buy their way back
 * in.
 */
export function canAutoUnfreeze(row: {
  isActive: boolean;
  frozenReason: string | null;
}): boolean {
  return !row.isActive && row.frozenReason === "billing";
}
