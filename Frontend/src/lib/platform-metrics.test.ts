import { describe, expect, it } from "vitest";

import {
  breakdownTenants,
  daysUntil,
  expiringTrials,
  monthlyRecurringCents,
  trialConversionPercent,
  trialPipelineCents,
  type TenantRow,
} from "@/lib/platform-metrics";
import { isSuperAdminEmail, parseSuperAdmins } from "@/lib/super-admin";

const tenant = (overrides: Partial<TenantRow> = {}): TenantRow => ({
  planType: "pro",
  subscriptionStatus: "active",
  isActive: true,
  ...overrides,
});

describe("super admin roster", () => {
  it("parses a comma list, ignoring case and padding", () => {
    expect(parseSuperAdmins(" A@x.com , b@Y.com ")).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
  });

  it("treats a missing or empty roster as denying everyone", () => {
    // Fail closed: a typo in the env var must not open the console.
    expect(isSuperAdminEmail("a@x.com", undefined)).toBe(false);
    expect(isSuperAdminEmail("a@x.com", "")).toBe(false);
    expect(isSuperAdminEmail("a@x.com", "   ")).toBe(false);
    expect(isSuperAdminEmail("a@x.com", ",,")).toBe(false);
  });

  it("matches case-insensitively and rejects everyone else", () => {
    const roster = "owner@bazman.app,ops@bazman.app";
    expect(isSuperAdminEmail("Owner@Bazman.app", roster)).toBe(true);
    expect(isSuperAdminEmail("ops@bazman.app", roster)).toBe(true);
    expect(isSuperAdminEmail("someone@else.com", roster)).toBe(false);
    expect(isSuperAdminEmail(null, roster)).toBe(false);
    expect(isSuperAdminEmail(undefined, roster)).toBe(false);
  });

  it("does not match on a substring", () => {
    // "evil-owner@bazman.app.attacker.com" must not pass on containment.
    expect(
      isSuperAdminEmail("owner@bazman.app.attacker.com", "owner@bazman.app"),
    ).toBe(false);
  });
});

describe("breakdownTenants", () => {
  it("counts an empty platform without dividing by anything", () => {
    expect(breakdownTenants([])).toEqual({
      total: 0,
      active: 0,
      trialing: 0,
      frozen: 0,
      cancelled: 0,
    });
  });

  it("counts a frozen tenant as frozen whatever its subscription says", () => {
    const rows = [
      tenant({ subscriptionStatus: "active", isActive: false }),
      tenant({ subscriptionStatus: "trialing", isActive: false }),
    ];
    const out = breakdownTenants(rows);

    expect(out.frozen).toBe(2);
    expect(out.active).toBe(0);
    expect(out.trialing).toBe(0);
  });

  it("splits live tenants by subscription state", () => {
    const out = breakdownTenants([
      tenant({ subscriptionStatus: "active" }),
      tenant({ subscriptionStatus: "active" }),
      tenant({ subscriptionStatus: "trialing" }),
      tenant({ subscriptionStatus: "cancelled" }),
    ]);

    expect(out).toEqual({
      total: 4,
      active: 2,
      trialing: 1,
      cancelled: 1,
      frozen: 0,
    });
  });
});

describe("monthlyRecurringCents", () => {
  it("is zero on an empty platform", () => {
    expect(monthlyRecurringCents([])).toBe(0);
  });

  it("counts only active, unfrozen tenants", () => {
    const rows = [
      tenant({ planType: "pro", subscriptionStatus: "active" }), // 9900
      tenant({ planType: "starter", subscriptionStatus: "active" }), // 6900
      tenant({ planType: "starter", subscriptionStatus: "trialing" }), // no
      tenant({
        planType: "pro",
        subscriptionStatus: "active",
        isActive: false,
      }),
      tenant({ planType: "pro", subscriptionStatus: "cancelled" }), // no
    ];

    expect(monthlyRecurringCents(rows)).toBe(16800);
  });

  it("contributes nothing for a free plan", () => {
    expect(
      monthlyRecurringCents([
        tenant({ planType: "free", subscriptionStatus: "active" }),
      ]),
    ).toBe(0);
  });

  it("separates the trial pipeline from committed revenue", () => {
    const rows = [
      tenant({ planType: "pro", subscriptionStatus: "active" }),
      tenant({ planType: "starter", subscriptionStatus: "trialing" }),
    ];

    expect(monthlyRecurringCents(rows)).toBe(9900);
    expect(trialPipelineCents(rows)).toBe(6900);
  });
});

describe("trialConversionPercent", () => {
  it("returns null while nobody has decided", () => {
    // Everyone still inside a trial: there is no rate to report yet.
    expect(trialConversionPercent([])).toBeNull();
    expect(
      trialConversionPercent([tenant({ subscriptionStatus: "trialing" })]),
    ).toBeNull();
  });

  it("excludes the trialing cohort from the denominator", () => {
    // 1 active, 1 cancelled, 8 still trialing => 50%, not 10%. Counting
    // undecided trials as failures makes growth look like collapse.
    const rows = [
      tenant({ subscriptionStatus: "active" }),
      tenant({ subscriptionStatus: "cancelled" }),
      ...Array.from({ length: 8 }, () =>
        tenant({ subscriptionStatus: "trialing" }),
      ),
    ];

    expect(trialConversionPercent(rows)).toBe(50);
  });

  it("reports 100 when everyone who decided converted", () => {
    expect(
      trialConversionPercent([
        tenant({ subscriptionStatus: "active" }),
        tenant({ subscriptionStatus: "active" }),
      ]),
    ).toBe(100);
  });

  it("counts a frozen tenant by its subscription, not its freeze", () => {
    // Freezing is an operational action; it does not undo the conversion.
    expect(
      trialConversionPercent([
        tenant({ subscriptionStatus: "active", isActive: false }),
      ]),
    ).toBe(100);
  });
});

describe("trial expiry helpers", () => {
  const now = new Date("2026-08-10T09:00:00Z");

  it("returns null for a tenant with no trial end", () => {
    expect(daysUntil(null, now)).toBeNull();
  });

  it("counts whole days, going negative once lapsed", () => {
    expect(daysUntil(new Date("2026-08-12T09:00:00Z"), now)).toBe(2);
    expect(daysUntil(new Date("2026-08-09T09:00:00Z"), now)).toBe(-1);
  });

  it("lists only trials inside the window, soonest first", () => {
    const rows = [
      { id: "in-40h", trialEndsAt: new Date("2026-08-12T01:00:00Z") },
      { id: "in-2h", trialEndsAt: new Date("2026-08-10T11:00:00Z") },
      { id: "in-5d", trialEndsAt: new Date("2026-08-15T09:00:00Z") },
      { id: "lapsed", trialEndsAt: new Date("2026-08-09T09:00:00Z") },
      { id: "none", trialEndsAt: null },
    ];

    expect(expiringTrials(rows, now).map((r) => r.id)).toEqual([
      "in-2h",
      "in-40h",
    ]);
  });

  it("handles an empty platform", () => {
    expect(expiringTrials([], now)).toEqual([]);
  });
});
