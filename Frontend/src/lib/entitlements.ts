import { toPlanType, TRIAL_PLAN } from "./plans";
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
  /**
   * The automated win-back message to lapsed clients (0021).
   *
   * Pro because it costs per tenant to run — it is WhatsApp traffic — and
   * because it is the one feature that speaks to the tenant's customers on
   * their behalf. Entitlement is necessary and **not sufficient**: the tenant
   * must also switch it on, and each client must have consented.
   */
  clientRetention: boolean;
  /**
   * "ליבי" — booking by Hebrew voice command from the dashboard.
   *
   * Pro for the same reason `clientRetention` is: it costs per tenant on every
   * use. Each command is a model call, and unlike every other feature here the
   * cost scales with how much a tenant *likes* it. That makes it the fourth
   * member of the set Pro already sells — the things that cost us something per
   * tenant rather than the things that merely took work to build once.
   *
   * Entitlement is necessary and not sufficient: the assistant also needs a
   * configured API key, and with none the control is not rendered at all.
   */
  voiceAssistant: boolean;
  prioritySupport: boolean;
};

const NOTHING: Entitlements = {
  customBranding: false,
  smsReminders: false,
  whatsappReminders: false,
  advancedAnalytics: false,
  clientRetention: false,
  voiceAssistant: false,
  prioritySupport: false,
};

/**
 * The tier line, and where it moved.
 *
 * **Custom branding is Basic, not Pro.** It used to be the headline Pro
 * feature, which meant the cheapest paying tenant got a booking page in
 * somebody else's colours — the one screen their clients actually see. A shop
 * paying anything at all should look like themselves; what Pro sells is the
 * work the *owner* does, not how the shop appears.
 *
 * Pro is therefore four things that all cost us something per tenant:
 * analytics, message delivery over SMS/WhatsApp, human setup time, and — since
 * Libi — model calls. The last one is the first whose cost scales with *use*
 * rather than with headcount, which is worth watching when 8e prices this.
 *
 * Staff management and the full calendar are in Basic's copy but appear
 * nowhere here on purpose. They are **ungated** — no entitlement key, no
 * check — and listing them is describing the product, not promising a switch.
 * Adding a gate for them now would be taking a feature away from every tenant
 * who already has it.
 *
 * `free` keeps nothing. It is not a tier anyone buys — it is the degraded
 * state during the non-payment grace window, so its job is to be worth
 * escaping.
 */
const BY_PLAN: Record<PlanType, Entitlements> = {
  free: NOTHING,
  starter: {
    customBranding: true,
    smsReminders: false,
    whatsappReminders: false,
    advancedAnalytics: false,
    clientRetention: false,
    voiceAssistant: false,
    prioritySupport: false,
  },
  pro: {
    customBranding: true,
    smsReminders: true,
    whatsappReminders: true,
    advancedAnalytics: true,
    clientRetention: true,
    voiceAssistant: true,
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
/** Statuses that entitle a tenant to anything at all. */
const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active"];

export type SubscriptionState = {
  planType: unknown;
  subscriptionStatus: unknown;
};

/**
 * Deliberately matches the raw column rather than routing it through
 * `toSubscriptionStatus`, which falls back to `trialing`.
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
function statusIs(
  subscriptionStatus: unknown,
  candidates: readonly SubscriptionStatus[],
): boolean {
  return (
    typeof subscriptionStatus === "string" &&
    (candidates as readonly string[]).includes(subscriptionStatus)
  );
}

export function isTrialing(state: SubscriptionState): boolean {
  return statusIs(state.subscriptionStatus, ["trialing"]);
}

/**
 * The tier a tenant is currently entitled to, which is rarely the tier stored
 * on the row. Both columns are varchar, so neither is trusted as written: a
 * value put there by psql or a seed cannot grant a feature.
 *
 * Three cases, in order:
 *
 * 1. **Trialing → `TRIAL_PLAN`**, whatever they picked. The chosen tier is a
 *    statement of intent for *after* the trial; during it they get the whole
 *    product. Without this, a tenant who picked Basic hit "upgrade your plan"
 *    walls during the exact window they were evaluating.
 * 2. **Active → the tier they actually pay for.**
 * 3. **Anything else → `free`.** Grace, cancelled, unrecognised.
 */
export function effectivePlan(state: SubscriptionState): PlanType {
  if (isTrialing(state)) return TRIAL_PLAN;
  if (statusIs(state.subscriptionStatus, ["active"])) {
    return toPlanType(state.planType);
  }
  return "free";
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

/**
 * True when billing state has taken features *away*, never when it has added
 * them.
 *
 * Compared against the entitled statuses rather than against the chosen tier:
 * a trialing Basic tenant now resolves to Pro, so a plain
 * `effectivePlan !== planType` comparison would report them as downgraded
 * while they are in fact being handed more than they picked.
 */
export function isDowngraded(state: SubscriptionState): boolean {
  if (statusIs(state.subscriptionStatus, ENTITLED_STATUSES)) return false;
  return toPlanType(state.planType) !== "free";
}
