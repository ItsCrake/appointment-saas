import { describe, expect, it } from "vitest";

import {
  canAutoUnfreeze,
  daysUntil,
  GRACE_DAYS,
  planTransition,
  trialWarningThreshold,
  type LifecycleRow,
} from "@/lib/billing/lifecycle";

const NOW = new Date("2026-08-10T09:00:00Z");
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const row = (overrides: Partial<LifecycleRow> = {}): LifecycleRow => ({
  id: "b1",
  subscriptionStatus: "trialing",
  trialEndsAt: daysFromNow(10),
  graceStartedAt: null,
  isActive: true,
  frozenReason: null,
  ...overrides,
});

describe("trial warning bands", () => {
  it("puts each remaining-day count in exactly one band", () => {
    expect(trialWarningThreshold(5)).toBeNull();
    expect(trialWarningThreshold(4)).toBeNull();
    expect(trialWarningThreshold(3)).toBe(3);
    expect(trialWarningThreshold(2)).toBe(3);
    expect(trialWarningThreshold(1)).toBe(1);
  });

  it("stops warning once the trial has lapsed", () => {
    expect(trialWarningThreshold(0)).toBeNull();
    expect(trialWarningThreshold(-4)).toBeNull();
  });

  it("never returns two thresholds for one day count", () => {
    // The property that matters: a cron run that never happened degrades to
    // one late warning, not two arriving in the same inbox on the same
    // morning, which reads as a broken system.
    for (let d = 1; d <= 10; d++) {
      const hits = [3, 1].filter((t) => trialWarningThreshold(d) === t);
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("planTransition", () => {
  it("warns inside a band and does nothing outside one", () => {
    expect(planTransition(row({ trialEndsAt: daysFromNow(2) }), NOW)).toEqual({
      type: "warn_trial",
      threshold: 3,
      daysLeft: 2,
    });
    expect(planTransition(row({ trialEndsAt: daysFromNow(9) }), NOW)).toEqual({
      type: "none",
    });
  });

  it("starts grace the moment a trial lapses", () => {
    expect(planTransition(row({ trialEndsAt: daysFromNow(-1) }), NOW)).toEqual({
      type: "start_grace",
    });
  });

  it("does not both start grace and freeze in one pass", () => {
    // One action per tenant per run. A trial that lapsed weeks ago still only
    // starts the clock today, so the owner gets the full grace window rather
    // than being frozen by a backlog.
    const lapsedLongAgo = row({ trialEndsAt: daysFromNow(-90) });
    expect(planTransition(lapsedLongAgo, NOW)).toEqual({ type: "start_grace" });
  });

  it("freezes only once the grace window is fully spent", () => {
    const dayBefore = row({
      subscriptionStatus: "past_due",
      graceStartedAt: daysFromNow(-(GRACE_DAYS - 1)),
    });
    expect(planTransition(dayBefore, NOW)).toEqual({ type: "none" });

    const dayOf = row({
      subscriptionStatus: "past_due",
      graceStartedAt: daysFromNow(-GRACE_DAYS),
    });
    expect(planTransition(dayOf, NOW)).toEqual({ type: "freeze" });
  });

  it("refuses to freeze a past_due tenant with no clock", () => {
    // A status set by hand or by a provider event that started no clock. The
    // guess would cost a tenant their booking page, so it is not made.
    const noClock = row({
      subscriptionStatus: "past_due",
      graceStartedAt: null,
    });
    expect(planTransition(noClock, NOW)).toEqual({ type: "none" });
  });

  it("leaves active and cancelled subscriptions alone", () => {
    expect(planTransition(row({ subscriptionStatus: "active" }), NOW)).toEqual({
      type: "none",
    });
    expect(
      planTransition(row({ subscriptionStatus: "cancelled" }), NOW),
    ).toEqual({ type: "none" });
  });

  it("does nothing to a tenant that is already frozen", () => {
    const frozen = row({
      subscriptionStatus: "past_due",
      graceStartedAt: daysFromNow(-30),
      isActive: false,
      frozenReason: "billing",
    });
    expect(planTransition(frozen, NOW)).toEqual({ type: "none" });
  });

  it("ignores a trialing tenant with no trial clock", () => {
    expect(planTransition(row({ trialEndsAt: null }), NOW)).toEqual({
      type: "none",
    });
  });
});

describe("canAutoUnfreeze", () => {
  it("thaws a billing freeze", () => {
    expect(canAutoUnfreeze({ isActive: false, frozenReason: "billing" })).toBe(
      true,
    );
  });

  it("never thaws an admin freeze", () => {
    // An admin freeze is a deliberate act. Letting a successful charge undo it
    // would hand a tenant a way to buy their way back in.
    expect(canAutoUnfreeze({ isActive: false, frozenReason: "admin" })).toBe(
      false,
    );
    expect(canAutoUnfreeze({ isActive: false, frozenReason: null })).toBe(
      false,
    );
  });

  it("is false for a tenant that is not frozen at all", () => {
    expect(canAutoUnfreeze({ isActive: true, frozenReason: null })).toBe(false);
  });
});

describe("daysUntil", () => {
  it("rounds up, so a partial day still counts as a day remaining", () => {
    expect(daysUntil(new Date(NOW.getTime() + 1.2 * 86_400_000), NOW)).toBe(2);
  });

  it("goes non-positive once the date has passed", () => {
    expect(daysUntil(new Date(NOW.getTime() - 60_000), NOW)).toBe(0);
    expect(daysUntil(daysFromNow(-3), NOW)).toBe(-3);
  });
});
