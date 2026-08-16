import { describe, expect, it } from "vitest";

import {
  effectivePlan,
  entitlementsFor,
  isDowngraded,
  type Entitlements,
} from "@/lib/entitlements";
import { PLAN_TYPES, SUBSCRIPTION_STATUSES, TRIAL_PLAN } from "@/lib/plans";

const state = (planType: unknown, subscriptionStatus: unknown) => ({
  planType,
  subscriptionStatus,
});

const FEATURES = [
  "customBranding",
  "smsReminders",
  "canSendWhatsapp",
  "canAccessAnalytics",
  "canAccessLibi",
  "prioritySupport",
] as const satisfies readonly (keyof Entitlements)[];

describe("effectivePlan", () => {
  it("honours the chosen tier while the tenant is actively paying", () => {
    expect(effectivePlan(state("pro", "active"))).toBe("pro");
    expect(effectivePlan(state("starter", "active"))).toBe("starter");
  });

  it("gives every trial the full product, whatever tier was picked", () => {
    // The bug this replaces: a tenant who picked Basic at signup hit
    // "upgrade your plan" walls during the exact window they were evaluating.
    expect(effectivePlan(state("starter", "trialing"))).toBe(TRIAL_PLAN);
    expect(effectivePlan(state("pro", "trialing"))).toBe(TRIAL_PLAN);
    expect(effectivePlan(state("free", "trialing"))).toBe(TRIAL_PLAN);
    // Even a garbage plan column, because the *status* is what grants here.
    expect(effectivePlan(state("enterprise", "trialing"))).toBe(TRIAL_PLAN);
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
    // An unknown *plan* on an active status still gets the default tier — the
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

  /**
   * The Starter line, asserted from both sides in one place.
   *
   * Design is the half people get wrong, because branding used to be the
   * headline *Pro* feature. It is not: a shop paying anything at all should
   * look like themselves, and the tier line is drawn around what costs us
   * something per tenant instead.
   */
  it("gives an actively-paying starter tenant the whole design surface", () => {
    const entitlements = entitlementsFor(state("starter", "active"));
    expect(entitlements.customBranding).toBe(true);
  });

  it("gates nothing about design, landing content or the calendar", () => {
    // Stated as an assertion about the *shape* of the type rather than about a
    // value: if somebody adds a `customLandingPage` or `fullCalendar` key and
    // sets it false for Starter, this fails and they have to argue for it.
    const starter = entitlementsFor(state("starter", "active"));
    const design = (Object.keys(starter) as (keyof Entitlements)[]).filter(
      (k) => /branding|design|landing|calendar|theme/i.test(k),
    );

    expect(design.length).toBeGreaterThan(0);
    for (const key of design) expect(starter[key]).toBe(true);
  });

  it("blocks starter from WhatsApp, analytics and Libi", () => {
    // The three the spec names, plus the two that share their reasoning. All
    // of them cost us something per tenant, which is the whole basis of the
    // tier line — `canSendWhatsapp` covers every client WhatsApp message, not
    // only the reminder.
    const entitlements = entitlementsFor(state("starter", "active"));

    expect(entitlements.canSendWhatsapp).toBe(false);
    expect(entitlements.canAccessAnalytics).toBe(false);
    expect(entitlements.canAccessLibi).toBe(false);

    expect(entitlements.smsReminders).toBe(false);
    expect(entitlements.prioritySupport).toBe(false);
  });

  it("gives pro every feature there is", () => {
    // Not a list to maintain: iterating the object means a new entitlement
    // added without a Pro value fails here rather than shipping half-gated.
    const entitlements = entitlementsFor(state("pro", "active"));
    for (const value of Object.values(entitlements)) expect(value).toBe(true);
  });

  it("unlocks every paid feature for a trialing starter tenant", () => {
    // The regression that started this: branding and gallery were blocked for
    // trial users, so the trial demonstrated the tier they had *not* chosen.
    const entitlements = entitlementsFor(state("starter", "trialing"));
    for (const feature of FEATURES) {
      expect(entitlements[feature]).toBe(true);
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
  it("is true only when billing state took features away", () => {
    expect(isDowngraded(state("pro", "past_due"))).toBe(true);
    expect(isDowngraded(state("pro", "active"))).toBe(false);
  });

  it("is false for a trial that grants more than the chosen tier", () => {
    // A plain `effectivePlan !== planType` comparison would call this a
    // downgrade, while the tenant is in fact being handed Pro for free.
    expect(effectivePlan(state("starter", "trialing"))).not.toBe("starter");
    expect(isDowngraded(state("starter", "trialing"))).toBe(false);
  });

  it("does not report a free tenant as downgraded", () => {
    // Nothing was taken away — there was nothing to take.
    expect(isDowngraded(state("free", "cancelled"))).toBe(false);
  });
});
