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

/**
 * How long the trial runs. It hands over `TRIAL_PLAN` — the whole of Pro,
 * **ליבי included** — whichever tier the owner picked, and the pricing page
 * says so. That sentence is derived rather than typed: `trialEntitlements()`
 * in `lib/entitlements.ts` is what decides whether the page may print it, and
 * `entitlements.test.ts` fails if the trial ever stops including her.
 */
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
  /**
   * The one thing only this tier sells, drawn apart from the list rather than
   * left as the fourth bullet somebody skims past. Pro's is ליבי — the feature
   * whose cost scales with how much a tenant uses it, and the reason Pro costs
   * more than a larger message allowance would explain.
   */
  exclusiveFeature?: string;
  /**
   * WhatsApp messages included in the monthly price, per calendar month.
   *
   * **An allowance, not a cap** — renamed from `whatsappMonthlyCap` when the
   * messages past it became priced rather than merely counted. Nothing stops a
   * tenant at it and nothing should: the message past the allowance is some
   * client's confirmation. One number, read by the pricing page, the terms and
   * the `/master` usage counter, so none of them can drift from the others.
   */
  whatsappIncluded: number;
  /**
   * What messages past the allowance cost: `cents` for every **started** block
   * of `per` messages — see `whatsappOverageCents`.
   *
   * Advertised and computed, not collected: there is no payment provider yet
   * (8d), so `/master` shows what a tenant has accrued and nothing charges it.
   */
  whatsappOverage: { per: number; cents: number };
  /** Exactly one tier should set this — it drives the "popular" treatment. */
  highlighted?: boolean;
};

/** The messages a resolved plan includes, or null when it sends no WhatsApp. */
export function whatsappIncludedFor(plan: PlanType): number | null {
  return (
    PRICING_TIERS.find((tier) => tier.id === plan)?.whatsappIncluded ?? null
  );
}

/**
 * What a month of WhatsApp traffic has accrued past the allowance, in agorot.
 *
 * **Every started block counts whole.** 101 messages on a 100 allowance is one
 * block of overage, not a hundredth of one — which is how a price quoted "for
 * every additional 100" is read wherever it is sold, and the only reading in
 * which the rate on the pricing page is the price somebody pays. Zero at or
 * under the allowance, and zero for a plan that sends no WhatsApp.
 */
export function whatsappOverageCents(plan: PlanType, sent: number): number {
  const tier = PRICING_TIERS.find((candidate) => candidate.id === plan);
  if (!tier) return 0;

  const extra = Math.max(0, Math.floor(sent) - tier.whatsappIncluded);
  const blocks = Math.ceil(extra / tier.whatsappOverage.per);
  return blocks * tier.whatsappOverage.cents;
}

/**
 * A tier's features with its exclusive one leading — for the compact pickers,
 * which show only the first few and must not show a Pro card without ליבי.
 */
export function headlineFeatures(tier: PricingTier): string[] {
  return tier.exclusiveFeature
    ? [tier.exclusiveFeature, ...tier.features]
    : tier.features;
}

/**
 * Two tiers. **Bookings are unlimited on both, always** — a busy month never
 * turns a client away at the door. What scales with volume is WhatsApp, because
 * that is what costs per message: each tier includes an allowance and prices
 * the messages past it by the hundred. Pro is ₪40 more for 250 more messages
 * and a cheaper hundred after them — and for ליבי, which nothing else buys.
 *
 * **The allowance is monitored, not enforced**, and that is a decision rather
 * than an unfinished job. The message past the allowance is a client's
 * confirmation or reminder; dropping it would punish the client for the shop's
 * plan, and blocking the booking behind it would be worse. So the overage is a
 * price, stated on the pricing page and in the terms exactly as the monthly
 * price is — and, exactly like the monthly price, nothing collects it until a
 * payment provider exists (8d). `/master` shows each tenant's month against the
 * allowance, with what they have accrued, so the number is checkable today.
 * Prices include VAT.
 *
 * Yearly is ten months for twelve, which is where the ~16% badge comes from.
 */
export const PRICING_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "בסיסי",
    tagline: "לעסק שרק מתחיל לקבל תורים אונליין",
    monthlyCents: 8000,
    yearlyCents: 80000,
    features: [
      "עמוד הזמנות אישי",
      "תורים ללא הגבלה",
      "100 הודעות וואטסאפ בחודש — אישורים ותזכורות",
      "צבע מותאם, גלריה וחוות דעת",
      "ניהול צוות ולוח שבועי מלא",
      "ביטול עצמאי ללקוח ותזכורות במייל",
    ],
    whatsappIncluded: 100,
    whatsappOverage: { per: 100, cents: 1500 },
  },
  {
    id: "pro",
    name: "מקצועי",
    tagline: "לעסק פעיל שרוצה פחות חלונות ריקים",
    monthlyCents: 12000,
    yearlyCents: 120000,
    exclusiveFeature: "ליבי — עוזרת קולית שמנהלת את היומן בדיבור",
    features: [
      "כל מה שבבסיסי",
      "350 הודעות וואטסאפ בחודש",
      "דוחות וסטטיסטיקות מתקדמים",
      "תזכורות גם ב-SMS",
      "ליווי אישי בהקמה",
      "תמיכה בעדיפות",
    ],
    whatsappIncluded: 350,
    whatsappOverage: { per: 100, cents: 1000 },
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
