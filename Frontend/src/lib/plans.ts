/**
 * Subscription config. Pure data with no JSX, so prices and copy can be edited
 * without touching a component — and so the maths below can be unit-tested.
 *
 * NOTE: nothing here charges anyone. There is no payment provider wired up, so
 * `plan_type` records an owner's *stated* choice and `subscription_status`
 * stays `trialing`. No feature is gated on either column. See ARCHITECTURE.md.
 */

export const PLAN_TYPES = ["free", "starter", "pro", "business"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const DEFAULT_PLAN: PlanType = "starter";
export const DEFAULT_STATUS: SubscriptionStatus = "trialing";

/** Never throws: a column written outside the app still renders a valid page. */
export function toPlanType(value: unknown): PlanType {
  return typeof value === "string" &&
    (PLAN_TYPES as readonly string[]).includes(value)
    ? (value as PlanType)
    : DEFAULT_PLAN;
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

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "בסיסי",
    tagline: "לעסק שרק מתחיל לקבל תורים אונליין",
    monthlyCents: 4900,
    yearlyCents: 49000,
    features: [
      "עמוד הזמנות אישי",
      "עד 100 תורים בחודש",
      "תזכורות במייל",
      "ביטול עצמאי ללקוח",
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
      "תורים ללא הגבלה",
      "גלריה, חוות דעת וצבע מותאם",
      "דוחות וסטטיסטיקות",
      "תמיכה בוואטסאפ",
    ],
    highlighted: true,
  },
  {
    id: "business",
    name: "עסקי",
    tagline: "לעסק עם כמה מטפלים או כמה סניפים",
    monthlyCents: 19900,
    yearlyCents: 199000,
    features: [
      "כל מה שבמקצועי",
      "מספר אנשי צוות",
      "תזכורות SMS",
      "ליווי בהקמה",
      "תמיכה בעדיפות",
    ],
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
