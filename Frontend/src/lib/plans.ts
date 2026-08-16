/**
 * Subscription config. Pure data with no JSX, so prices and copy can be edited
 * without touching a component — and so the maths below can be unit-tested.
 *
 * NOTE: nothing here charges anyone yet. There is no payment provider wired up,
 * so `plan_type` records an owner's *stated* choice and `subscription_status`
 * stays `trialing`. What each tier *buys* now lives in `lib/entitlements.ts`
 * and is enforced; what it *costs* still is not collected. See ARCHITECTURE.md.
 */

/**
 * Two purchasable tiers. `free` is not a product and is never offered on the
 * pricing page — it is the degraded state a tenant falls to during the
 * non-payment grace window, which is why it has to be a legal column value.
 */
export const PLAN_TYPES = ["free", "starter", "pro"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/**
 * Tiers that no longer exist, mapped to their successor.
 *
 * `business` was folded into `pro` when the line went from three tiers to two.
 * Mapping it *up* rather than letting it fall to the default is deliberate: it
 * was the most expensive tier, and silently demoting a tenant who paid the most
 * would be the worst possible outcome of a repackaging.
 *
 * This lands before the migration that rewrites the rows, not after. Code must
 * tolerate the old value while it is still in the database — the reverse order
 * would break every `/master` read between deploy and migration.
 */
const LEGACY_PLAN_ALIASES: Record<string, PlanType> = { business: "pro" };

/**
 * `past_due` is listed here before anything can write it: migration 0012
 * widens the CHECK constraint that still rejects it. Teaching the code the
 * value first is the safe order — until then `toSubscriptionStatus` would
 * normalise it to `trialing`, which is a *silent grant of paid features* to a
 * tenant who has stopped paying. A status that means "not paying" must never
 * round-trip into one that means "paying".
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const DEFAULT_PLAN: PlanType = "starter";
export const DEFAULT_STATUS: SubscriptionStatus = "trialing";

/** Never throws: a column written outside the app still renders a valid page. */
export function toPlanType(value: unknown): PlanType {
  if (typeof value !== "string") return DEFAULT_PLAN;
  if ((PLAN_TYPES as readonly string[]).includes(value))
    return value as PlanType;
  return LEGACY_PLAN_ALIASES[value] ?? DEFAULT_PLAN;
}

export function toSubscriptionStatus(value: unknown): SubscriptionStatus {
  return typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : DEFAULT_STATUS;
}

export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const TRIAL_DAYS = 14;

/**
 * The tier a trial hands over, regardless of which one the owner picked during
 * onboarding.
 *
 * A trial exists to show the product, so it shows the *whole* product. Giving a
 * tenant who picked Basic only Basic features during their trial means the one
 * window in which they are actively evaluating is the one window they cannot
 * see what they would be paying more for. It is also how a trial produces a
 * "your plan does not include this" wall, which is the worst possible sentence
 * to show someone who has not decided yet.
 */
export const TRIAL_PLAN: PlanType = "pro";

export type PricingTier = {
  id: Exclude<PlanType, "free">;
  name: string;
  tagline: string;
  /** Agorot per month, billed monthly. */
  monthlyCents: number;
  /** Agorot for a full year paid up front. */
  yearlyCents: number;
  features: string[];
  /** Exactly one tier should set this — it drives the "popular" treatment. */
  highlighted?: boolean;
};

/**
 * Two tiers, separated by features only — never by volume. Both include
 * unlimited bookings, so a busy month can never turn into a surprise bill or a
 * client turned away at the door. Nothing here may reintroduce a usage cap
 * without `lib/entitlements.ts` gaining a counter to enforce it.
 *
 * Yearly is ten months for twelve, which is where the ~16% badge comes from.
 */
export const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "בסיסי",
    tagline: "לעסק שרק מתחיל לקבל תורים אונליין",
    monthlyCents: 6900,
    yearlyCents: 69000,
    features: [
      "עמוד הזמנות אישי",
      "תורים ללא הגבלה",
      "צבע מותאם, גלריה וחוות דעת",
      "ניהול צוות ולוח שבועי מלא",
      "תזכורות במייל וביטול עצמאי ללקוח",
    ],
  },
  {
    id: "pro",
    name: "מקצועי",
    tagline: "לעסק פעיל שרוצה פחות חלונות ריקים",
    monthlyCents: 9900,
    yearlyCents: 99000,
    features: [
      "כל מה שבבסיסי",
      "דוחות וסטטיסטיקות מתקדמים",
      "תזכורות בוואטסאפ ו-SMS",
      "ליווי אישי בהקמה",
      "תמיכה בעדיפות",
    ],
    highlighted: true,
  },
];

export function findTier(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((tier) => tier.id === id);
}

/** Agorot per month when paying yearly — what the card actually displays. */
export function monthlyEquivalentCents(tier: PricingTier): number {
  return Math.round(tier.yearlyCents / 12);
}

/**
 * Whole-percent discount of the yearly price against twelve monthly payments.
 * Rounded down so the badge can never overstate the saving.
 */
export function yearlySavingsPercent(tier: PricingTier): number {
  const twelveMonths = tier.monthlyCents * 12;
  if (twelveMonths === 0) return 0;
  return Math.floor(((twelveMonths - tier.yearlyCents) / twelveMonths) * 100);
}

/** The saving advertised on the billing toggle — the smallest any tier gives. */
export function headlineSavingsPercent(
  tiers: PricingTier[] = PRICING_TIERS,
): number {
  if (tiers.length === 0) return 0;
  return Math.min(...tiers.map(yearlySavingsPercent));
}

export function priceForCycle(tier: PricingTier, cycle: BillingCycle): number {
  return cycle === "yearly" ? monthlyEquivalentCents(tier) : tier.monthlyCents;
}

/**
 * Tiers a human may be moved between by hand.
 *
 * `free` is deliberately absent. It is not a tier anyone is *put on* — it is
 * the degraded state a tenant falls into during the grace window, produced by
 * `effectivePlan` from a non-paying status rather than stored. Offering it in a
 * support tool would let an admin manufacture a state indistinguishable from a
 * lapsed subscription, which is exactly the ambiguity the lifecycle exists to
 * remove.
 */
export const ASSIGNABLE_PLANS = PRICING_TIERS.map((tier) => tier.id);

/**
 * The Hebrew name of a tier, derived from `PRICING_TIERS` rather than restated.
 *
 * The console and the pricing page must call a tier the same thing — an admin
 * moving somebody to "מקצועי" and a customer buying "Pro" have to be talking
 * about the same product. `free` has no marketing name, so it gets the one word
 * that describes what it actually is.
 */
export function planLabel(plan: PlanType): string {
  return PRICING_TIERS.find((tier) => tier.id === plan)?.name ?? "מושהה";
}
