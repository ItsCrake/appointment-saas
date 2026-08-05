import { toPlanType } from "./plans";
import type { PlanType, SubscriptionStatus } from "./plans";

/**
 * What a tier actually buys, and the one place that decides it.
 *
 * Pure, like `platform-metrics.ts` — no IO and no database handle, so every
 * rule below is unit-testable and callable from a server action, a page, or the
 * notification enqueuer without any of them reaching for a query.
 *
 * Deliberately all booleans. The tier line is separated by *features*, never by
 * volume: both paid tiers include unlimited bookings, so nothing here counts
 * anything. Adding a usage cap would mean adding IO to this module, which is
 * the signal to stop and reconsider — a cap punishes a tenant's client for the
 * tenant's plan choice, and turns a booking page into a paywall at the worst
 * possible moment.
 */
export type Entitlements = {
  /** Accent colour, hero media, gallery and reviews on the public page. */
  customBranding: boolean;
  /** Client reminders over SMS rather than email. */
  smsReminders: boolean;
  /** Client reminders over WhatsApp. */
  whatsappReminders: boolean;
  /** Revenue and new-client breakdowns beyond the basic counts. */
  advancedAnalytics: boolean;
  prioritySupport: boolean;
};

const NOTHING: Entitlements = {
  customBranding: false,
  smsReminders: false,
  whatsappReminders: false,
  advancedAnalytics: false,
  prioritySupport: false,
};

/**
 * `free` and `starter` are identical here, and that is not an oversight.
 *
 * Everything Starter sells — the booking page, unlimited bookings, email
 * reminders, self-service cancellation, the basic dashboard — is baseline
 * product that no tenant is ever denied. Starter buys *the right to keep using
 * it*, not an extra capability, so there is nothing to switch off when a
 * Starter tenant stops paying.
 *
 * The practical consequence is worth stating plainly rather than discovering
 * later: **for a Starter tenant the grace window applies no pressure at all.**
 * The freeze at the end of it is the only real enforcement they will feel.
 */
const BY_PLAN: Record<PlanType, Entitlements> = {
  free: NOTHING,
  starter: NOTHING,
  pro: {
    customBranding: true,
    smsReminders: true,
    whatsappReminders: true,
    advancedAnalytics: true,
    prioritySupport: true,
  },
};

/**
 * Statuses that entitle a tenant to the tier they picked.
 *
 * A trial is included: the whole point is to hand over the real product. Every
 * other status — `past_due` during the grace window, `cancelled` after it —
 * falls back to `free`, which is what makes the downgrade a single rule rather
 * than a second code path in every consumer.
 */
const PAYING_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active"];

export type SubscriptionState = {
  planType: unknown;
  subscriptionStatus: unknown;
};

/**
 * Deliberately matches the raw column against the paying set rather than
 * routing it through `toSubscriptionStatus`, which falls back to `trialing`.
 *
 * That fallback is right for display — `/master` showing "trialing" for a
 * corrupt row is harmless — and wrong for entitlement, because it converts an
 * unrecognised status into a *grant*. The realistic way an unrecognised status
 * appears is a provider webhook writing one the TypeScript constant has not
 * learned yet (`unpaid`, `incomplete_expired`, `paused`), and virtually every
 * such status means the tenant is not paying. Unknown therefore means free.
 *
 * The two functions default in opposite directions on purpose: display leans
 * readable, entitlement leans restrictive.
 */
function isPaying(subscriptionStatus: unknown): boolean {
  return (
    typeof subscriptionStatus === "string" &&
    (PAYING_STATUSES as readonly string[]).includes(subscriptionStatus)
  );
}

/**
 * The tier a tenant is currently entitled to, which is not always the tier they
 * chose. Both columns are varchar, so neither is trusted as written: a value
 * put there by psql or a seed cannot grant a feature.
 */
export function effectivePlan(state: SubscriptionState): PlanType {
  if (!isPaying(state.subscriptionStatus)) return "free";
  return toPlanType(state.planType);
}

/**
 * The single entry point. Takes the business row (or anything carrying the two
 * columns) rather than a `PlanType`, so no caller can accidentally consult the
 * plan without the status — which is the mistake that would leave a lapsed
 * tenant holding paid features.
 */
export function entitlementsFor(state: SubscriptionState): Entitlements {
  return BY_PLAN[effectivePlan(state)];
}

/** True when the tier was downgraded by billing state rather than by choice. */
export function isDowngraded(state: SubscriptionState): boolean {
  return (
    effectivePlan(state) !== toPlanType(state.planType) &&
    toPlanType(state.planType) !== "free"
  );
}
