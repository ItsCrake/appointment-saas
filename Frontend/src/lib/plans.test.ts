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
  type PricingTier,
} from "@/lib/plans";

const tier = (overrides: Partial<PricingTier> = {}): PricingTier => ({
  id: "starter",
  name: "בסיסי",
  tagline: "",
  monthlyCents: 10000,
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
    expect(toSubscriptionStatus("past_due")).toBe("trialing");
    expect(toSubscriptionStatus(undefined)).toBe("trialing");
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
