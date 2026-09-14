import { describe, expect, it } from "vitest";

import { FAQS, FEATURES, STEPS } from "@/lib/landing-content";
import {
  findTier,
  headlineSavingsPercent,
  monthlyEquivalentCents,
  PLAN_TYPES,
  PRICING_TIERS,
  priceForCycle,
  SUBSCRIPTION_STATUSES,
  toPlanType,
  toSubscriptionStatus,
  yearlySavingsPercent,
  headlineFeatures,
  whatsappIncludedFor,
  whatsappOverageCents,
  type PricingTier,
} from "@/lib/plans";

const tier = (overrides: Partial<PricingTier> = {}): PricingTier => ({
  id: "starter",
  name: "בסיסי",
  tagline: "",
  monthlyCents: 10000,
  whatsappIncluded: 50,
  whatsappOverage: { per: 100, cents: 1500 },
  yearlyCents: 100000,
  features: [],
  ...overrides,
});

describe("plan columns", () => {
  it("falls back rather than throwing on an unknown column value", () => {
    expect(toPlanType("pro")).toBe("pro");
    expect(toPlanType("enterprise")).toBe("starter");
    expect(toPlanType(null)).toBe("starter");

    expect(toSubscriptionStatus("active")).toBe("active");
    expect(toSubscriptionStatus("gibberish")).toBe("trialing");
    expect(toSubscriptionStatus(undefined)).toBe("trialing");
  });

  it("maps the retired business tier up to pro, never down to the default", () => {
    // Rows written before the three-tier line was collapsed still say
    // "business". Falling back to DEFAULT_PLAN would demote the tenant who was
    // paying the most, which is the one outcome a repackaging must not produce.
    expect(toPlanType("business")).toBe("pro");
  });

  it("keeps past_due distinct instead of normalising it to trialing", () => {
    // The whole point of listing it early: a status meaning "not paying" must
    // never round-trip into one that entitles the tenant to paid features.
    expect(toSubscriptionStatus("past_due")).toBe("past_due");
  });

  it("accepts every listed value", () => {
    for (const plan of PLAN_TYPES) expect(toPlanType(plan)).toBe(plan);
    for (const status of SUBSCRIPTION_STATUSES) {
      expect(toSubscriptionStatus(status)).toBe(status);
    }
  });
});

describe("pricing maths", () => {
  it("divides the yearly price into a monthly equivalent", () => {
    expect(monthlyEquivalentCents(tier({ yearlyCents: 120000 }))).toBe(10000);
  });

  it("reports the yearly discount against twelve monthly payments", () => {
    // 12 x 10000 = 120000 billed monthly; 100000 yearly is a 16.6% saving.
    expect(yearlySavingsPercent(tier())).toBe(16);
  });

  it("rounds the saving down so the badge never overstates it", () => {
    // 12 x 100 = 1200 vs 1001 yearly => 16.58%, must not advertise 17.
    expect(
      yearlySavingsPercent(tier({ monthlyCents: 100, yearlyCents: 1001 })),
    ).toBe(16);
  });

  it("never divides by zero on a free tier", () => {
    expect(
      yearlySavingsPercent(tier({ monthlyCents: 0, yearlyCents: 0 })),
    ).toBe(0);
  });

  it("headlines the smallest saving of any tier, never the largest", () => {
    const tiers = [
      tier({ id: "starter", monthlyCents: 100, yearlyCents: 1000 }), // 16%
      tier({ id: "pro", monthlyCents: 100, yearlyCents: 600 }), // 50%
    ];
    expect(headlineSavingsPercent(tiers)).toBe(16);
  });

  it("handles an empty tier list", () => {
    expect(headlineSavingsPercent([])).toBe(0);
  });

  it("switches the displayed price with the billing cycle", () => {
    const t = tier({ monthlyCents: 9900, yearlyCents: 99000 });
    expect(priceForCycle(t, "monthly")).toBe(9900);
    expect(priceForCycle(t, "yearly")).toBe(8250);
  });
});

describe("shipped config", () => {
  it("every tier id is a real plan type and is findable", () => {
    for (const t of PRICING_TIERS) {
      expect(PLAN_TYPES).toContain(t.id);
      expect(findTier(t.id)).toEqual(t);
    }
    expect(findTier("nope")).toBeUndefined();
  });

  it("highlights exactly one tier", () => {
    expect(PRICING_TIERS.filter((t) => t.highlighted)).toHaveLength(1);
  });

  it("ships the two-tier line at the agreed prices", () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual(["starter", "pro"]);
    expect(findTier("starter")?.monthlyCents).toBe(8000);
    expect(findTier("pro")?.monthlyCents).toBe(12000);
    // Ten months for twelve, as it has always been.
    expect(findTier("starter")?.yearlyCents).toBe(80000);
    expect(findTier("pro")?.yearlyCents).toBe(120000);
  });

  it("sells ליבי on Pro and only on Pro", () => {
    expect(findTier("pro")?.exclusiveFeature).toContain("ליבי");
    expect(findTier("starter")?.exclusiveFeature).toBeUndefined();
    for (const t of PRICING_TIERS) {
      if (t.id === "pro") continue;
      expect(headlineFeatures(t).join(" ")).not.toContain("ליבי");
    }
  });

  it("puts the exclusive feature where a three-line picker shows it", () => {
    // Onboarding shows the first three. A Pro card there without ליבי is a Pro
    // card without the reason to pick it.
    expect(headlineFeatures(findTier("pro")!).slice(0, 3)[0]).toContain("ליבי");
    // And Basic's allowance is inside its first three, since it is now what
    // separates the tiers.
    expect(
      headlineFeatures(findTier("starter")!).slice(0, 3).join(" "),
    ).toContain("הודעות וואטסאפ");
  });

  it("sells no tier on booking volume", () => {
    // Both tiers include unlimited bookings. A feature line implying a cap
    // would be advertising an entitlement nothing enforces — and enforcing it
    // would mean turning a paying client away at someone else's booking page.
    for (const t of PRICING_TIERS) {
      for (const feature of t.features) {
        expect(feature).not.toMatch(/עד \d+ תורים/);
      }
    }
  });

  it("prices every tier so yearly beats monthly", () => {
    for (const t of PRICING_TIERS) {
      expect(t.yearlyCents).toBeLessThan(t.monthlyCents * 12);
      expect(yearlySavingsPercent(t)).toBeGreaterThan(0);
    }
  });

  it("ships non-empty landing copy", () => {
    expect(FEATURES.length).toBeGreaterThan(0);
    expect(STEPS).toHaveLength(3);
    expect(FAQS.length).toBeGreaterThan(0);
    for (const faq of FAQS) {
      expect(faq.question.trim()).not.toBe("");
      expect(faq.answer.trim()).not.toBe("");
    }
  });
});

/**
 * The allowance is data rather than a literal in the UI, so the marketing copy
 * on the landing page and the usage counter in /master cannot drift apart.
 */
describe("whatsappIncludedFor", () => {
  it("matches the allowances the pricing page advertises", () => {
    expect(whatsappIncludedFor("starter")).toBe(100);
    expect(whatsappIncludedFor("pro")).toBe(350);
  });

  it("has no allowance for a plan that sends no WhatsApp", () => {
    // `free` is what a frozen or lapsed tenant resolves to, and it has no
    // WhatsApp entitlement at all — so there is no allowance to report.
    expect(whatsappIncludedFor("free")).toBeNull();
  });

  it("states the same number the tier's own copy does", () => {
    for (const tier of PRICING_TIERS) {
      const advertised = tier.features.find((f) =>
        f.includes("הודעות וואטסאפ"),
      );
      expect(advertised).toContain(String(tier.whatsappIncluded));
    }
  });
});

describe("whatsappOverageCents", () => {
  it("ships the agreed overage rates", () => {
    expect(findTier("starter")?.whatsappOverage).toEqual({ per: 100, cents: 1500 });
    expect(findTier("pro")?.whatsappOverage).toEqual({ per: 100, cents: 1000 });
  });

  it("charges nothing at or under the allowance", () => {
    expect(whatsappOverageCents("starter", 0)).toBe(0);
    expect(whatsappOverageCents("starter", 100)).toBe(0);
    expect(whatsappOverageCents("pro", 350)).toBe(0);
  });

  it("counts every started hundred whole", () => {
    // One message past is a block — "for every additional 100" read the way
    // it is read wherever a price is quoted per block.
    expect(whatsappOverageCents("starter", 101)).toBe(1500);
    expect(whatsappOverageCents("starter", 200)).toBe(1500);
    expect(whatsappOverageCents("starter", 201)).toBe(3000);
    expect(whatsappOverageCents("pro", 351)).toBe(1000);
    expect(whatsappOverageCents("pro", 650)).toBe(3000);
  });

  it("accrues nothing for a plan with no WhatsApp", () => {
    expect(whatsappOverageCents("free", 500)).toBe(0);
  });

  it("ignores a fractional or negative count rather than inventing a charge", () => {
    expect(whatsappOverageCents("starter", 100.9)).toBe(0);
    expect(whatsappOverageCents("starter", -5)).toBe(0);
  });
});
