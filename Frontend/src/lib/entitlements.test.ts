import { describe, expect, it } from "vitest";

import {
  effectivePlan,
  entitlementsFor,
  isDowngraded,
  type Entitlements,
} from "@/lib/entitlements";
import { PLAN_TYPES, SUBSCRIPTION_STATUSES } from "@/lib/plans";

const state = (planType: unknown, subscriptionStatus: unknown) => ({
  planType,
  subscriptionStatus,
});

const FEATURES = [
  "customBranding",
  "smsReminders",
  "whatsappReminders",
  "advancedAnalytics",
  "prioritySupport",
] as const satisfies readonly (keyof Entitlements)[];

describe("effectivePlan", () => {
  it("honours the chosen tier while the tenant is paying or trialing", () => {
    expect(effectivePlan(state("pro", "active"))).toBe("pro");
    expect(effectivePlan(state("pro", "trialing"))).toBe("pro");
    expect(effectivePlan(state("starter", "active"))).toBe("starter");
  });

  it("drops to free the moment the subscription stops paying", () => {
    expect(effectivePlan(state("pro", "past_due"))).toBe("free");
    expect(effectivePlan(state("pro", "cancelled"))).toBe("free");
  });

  it("maps a retired business row to pro before applying status", () => {
    expect(effectivePlan(state("business", "active"))).toBe("pro");
    expect(effectivePlan(state("business", "cancelled"))).toBe("free");
  });

  it("never throws on a value written outside the app", () => {
    // An unknown *plan* on a paying status still gets the default tier — the
    // tenant is paying, so denying them everything would be the wrong bias.
    expect(effectivePlan(state("enterprise", "active"))).toBe("starter");
    // An unknown *status* is the opposite case, and resolves to free.
    expect(effectivePlan(state(null, undefined))).toBe("free");
    expect(effectivePlan(state(42, {}))).toBe("free");
  });
});

describe("entitlementsFor", () => {
  it("gives a paying pro tenant everything", () => {
    const entitlements = entitlementsFor(state("pro", "active"));
    for (const feature of FEATURES) {
      expect(entitlements[feature]).toBe(true);
    }
  });

  it("gives a starter tenant no paid feature", () => {
    const entitlements = entitlementsFor(state("starter", "active"));
    for (const feature of FEATURES) {
      expect(entitlements[feature]).toBe(false);
    }
  });

  it("revokes every paid feature when a pro subscription lapses", () => {
    // The single rule that makes the grace-window downgrade work without a
    // second code path in every consumer.
    for (const status of ["past_due", "cancelled"] as const) {
      const entitlements = entitlementsFor(state("pro", status));
      for (const feature of FEATURES) {
        expect(entitlements[feature]).toBe(false);
      }
    }
  });

  it("keeps a trialing pro tenant on the full product", () => {
    // A trial that withholds the thing being trialled is not a trial.
    expect(entitlementsFor(state("pro", "trialing")).customBranding).toBe(true);
  });

  it("returns a complete object for every plan and status pairing", () => {
    for (const plan of PLAN_TYPES) {
      for (const status of SUBSCRIPTION_STATUSES) {
        const entitlements = entitlementsFor(state(plan, status));
        for (const feature of FEATURES) {
          expect(typeof entitlements[feature]).toBe("boolean");
        }
      }
    }
  });

  it("fails closed on a status the code does not recognise", () => {
    // The realistic source of an unknown status is a provider webhook writing
    // one the constant has not learned yet — `unpaid`, `incomplete_expired`,
    // `paused`. Nearly all of them mean "not paying", so an unrecognised value
    // must never resolve to a grant. This is why entitlement does not reuse
    // `toSubscriptionStatus`, whose fallback is `trialing`.
    for (const unknown of ["unpaid", "incomplete_expired", "paused", ""]) {
      expect(entitlementsFor(state("pro", unknown)).customBranding).toBe(false);
    }
  });
});

describe("isDowngraded", () => {
  it("is true only when billing state overrode the chosen tier", () => {
    expect(isDowngraded(state("pro", "past_due"))).toBe(true);
    expect(isDowngraded(state("pro", "active"))).toBe(false);
    expect(isDowngraded(state("starter", "trialing"))).toBe(false);
  });

  it("does not report a free tenant as downgraded", () => {
    // Nothing was taken away — there was nothing to take.
    expect(isDowngraded(state("free", "cancelled"))).toBe(false);
  });
});
