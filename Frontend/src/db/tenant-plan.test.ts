import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  extendTrial,
  getBusinessById,
  setTenantActive,
  setTenantPlan,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { effectivePlan, entitlementsFor, isFrozen } from "@/lib/entitlements";
import { createBusiness } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * Moving a tenant between tiers by hand, from `/master`.
 *
 * Run against real Postgres rather than mocked, because the property that
 * matters most here is enforced by the **database**: `plan_type` carries a
 * CHECK constraint, and the whole point of this control is that an admin
 * cannot put a tenant into a state the rest of the product cannot read.
 */

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

async function tenant(overrides: Record<string, unknown> = {}) {
  return createBusiness(db, {
    slug: `plan-${randomUUID().slice(0, 8)}`,
    ...overrides,
  });
}

describe("setTenantPlan", () => {
  it("moves a paying tenant from starter to pro", async () => {
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "active",
    });

    expect(await setTenantPlan(db, business.id, "pro")).toBe(true);

    const after = await getBusinessById(db, business.id);
    expect(after?.planType).toBe("pro");
  });

  it("moves back down again", async () => {
    const business = await tenant({
      planType: "pro",
      subscriptionStatus: "active",
    });

    await setTenantPlan(db, business.id, "starter");

    const after = await getBusinessById(db, business.id);
    expect(after?.planType).toBe("starter");
  });

  it("reports a missing tenant rather than silently doing nothing", async () => {
    // An update matching no row is not an error in SQL. Returning false is what
    // lets the action say "העסק לא נמצא" instead of a success toast for a write
    // that never happened.
    expect(await setTenantPlan(db, randomUUID(), "pro")).toBe(false);
  });

  /**
   * The safety property of the whole control. Status is what says money is
   * arriving; a support tool that could set it would be inventing revenue.
   */
  it("never touches subscription_status", async () => {
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "past_due",
    });

    await setTenantPlan(db, business.id, "pro");

    const after = await getBusinessById(db, business.id);
    expect(after?.subscriptionStatus).toBe("past_due");
  });

  it("leaves the trial clock alone", async () => {
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "trialing",
    });
    const before = await getBusinessById(db, business.id);

    await setTenantPlan(db, business.id, "pro");

    const after = await getBusinessById(db, business.id);
    expect(after?.trialEndsAt?.getTime()).toBe(before?.trialEndsAt?.getTime());
  });

  it("changes one tenant and no other", async () => {
    const a = await tenant({
      planType: "starter",
      subscriptionStatus: "active",
    });
    const b = await tenant({
      planType: "starter",
      subscriptionStatus: "active",
    });

    await setTenantPlan(db, a.id, "pro");

    expect((await getBusinessById(db, b.id))?.planType).toBe("starter");
  });

  /**
   * `free` is representable in the column but the action refuses it — this
   * pins the database half of that, so the constraint cannot quietly widen.
   */
  it("rejects a tier the CHECK constraint does not allow", async () => {
    const business = await tenant({ subscriptionStatus: "active" });

    await expect(
      // Deliberately past the type, the way a psql session or a bad migration
      // would arrive.
      setTenantPlan(db, business.id, "enterprise" as never),
    ).rejects.toThrow();
  });
});

describe("entitlements after a plan change", () => {
  it("takes effect immediately for an actively paying tenant", async () => {
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "active",
    });

    expect(
      entitlementsFor((await getBusinessById(db, business.id))!)
        .canAccessAnalytics,
    ).toBe(false);

    await setTenantPlan(db, business.id, "pro");

    // Read fresh from the row: `entitlementsFor` is pure and holds no cache, so
    // the next request after the write already sees the new tier.
    expect(
      entitlementsFor((await getBusinessById(db, business.id))!)
        .canAccessAnalytics,
    ).toBe(true);
  });

  /**
   * The behaviour that looks like a bug from the console, pinned so nobody
   * "fixes" it into a control that grants paid features to a non-payer.
   */
  it("changes nothing a trialing tenant can see — a trial already grants Pro", async () => {
    const business = await tenant({
      planType: "pro",
      subscriptionStatus: "trialing",
    });

    const before = entitlementsFor((await getBusinessById(db, business.id))!);
    await setTenantPlan(db, business.id, "starter");
    const after = entitlementsFor((await getBusinessById(db, business.id))!);

    expect(before).toEqual(after);
    // What it *did* change is where they land when the trial ends.
    expect((await getBusinessById(db, business.id))?.planType).toBe("starter");
  });

  it("grants a past_due tenant nothing, whatever tier is assigned", async () => {
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "past_due",
    });

    await setTenantPlan(db, business.id, "pro");

    const entitlements = entitlementsFor(
      (await getBusinessById(db, business.id))!,
    );
    expect(entitlements.canAccessAnalytics).toBe(false);
    expect(entitlements.canAccessLibi).toBe(false);
  });
});

/**
 * The `/master` status bugs, against real Postgres.
 *
 * All three reported symptoms are one question — *what is this tenant actually
 * served* — answered by two columns the console was not reading together.
 */
describe("frozen tenants", () => {
  it("are served nothing, whatever tier or status they hold", async () => {
    // The reported symptom from the other side: a frozen tenant on a live
    // subscription used to resolve to `pro`, so /master printed "מקצועי" while
    // the status pill beside it said frozen.
    for (const status of ["active", "trialing"] as const) {
      const business = await tenant({
        planType: "pro",
        subscriptionStatus: status,
        isActive: false,
        frozenReason: "admin",
      });

      const row = (await getBusinessById(db, business.id))!;
      expect(isFrozen(row)).toBe(true);
      expect(effectivePlan(row)).toBe("free");
      expect(entitlementsFor(row).canAccessAnalytics).toBe(false);
      expect(entitlementsFor(row).canAccessLibi).toBe(false);
    }
  });

  it("outrank a running trial", async () => {
    // A trial normally grants the full product. A freeze is the one thing that
    // overrides it — the public page is dark, so a tier nobody can use is not
    // a tier they have.
    const business = await tenant({
      planType: "starter",
      subscriptionStatus: "trialing",
      isActive: false,
      frozenReason: "billing",
    });

    expect(effectivePlan((await getBusinessById(db, business.id))!)).toBe(
      "free",
    );
  });

  it("come back to their real tier the moment they are unfrozen", async () => {
    const business = await tenant({
      planType: "pro",
      subscriptionStatus: "active",
      isActive: false,
      frozenReason: "admin",
    });

    await setTenantActive(db, business.id, true);

    const row = (await getBusinessById(db, business.id))!;
    expect(effectivePlan(row)).toBe("pro");
    // The pair the schema requires: no reason survives an unfreeze, or a later
    // admin freeze could be lifted automatically by a payment.
    expect(row.frozenReason).toBeNull();
  });

  it("record an admin reason when frozen from the console", async () => {
    const business = await tenant({ subscriptionStatus: "active" });
    await setTenantActive(db, business.id, false);

    const row = (await getBusinessById(db, business.id))!;
    expect(row.isActive).toBe(false);
    expect(row.frozenReason).toBe("admin");
  });
});

describe("extending a lapsed trial", () => {
  const DAY = 86_400_000;

  /** The exact state the sweep leaves behind when a trial runs out. */
  async function lapsed() {
    return tenant({
      planType: "starter",
      subscriptionStatus: "past_due",
      trialEndsAt: new Date(Date.now() - 3 * DAY),
      graceStartedAt: new Date(Date.now() - 3 * DAY),
    });
  }

  /**
   * The reported bug. Pushing the clock forward while leaving the status at
   * `past_due` meant an admin extended a trial, the console went on saying
   * "מושהה", and nothing they could see had changed.
   */
  it("puts the tenant back on trial rather than only moving the clock", async () => {
    const business = await lapsed();
    expect(effectivePlan((await getBusinessById(db, business.id))!)).toBe(
      "free",
    );

    await extendTrial(db, business.id, 7, new Date());

    const row = (await getBusinessById(db, business.id))!;
    expect(row.subscriptionStatus).toBe("trialing");
    expect(effectivePlan(row)).toBe("pro"); // TRIAL_PLAN
    expect(entitlementsFor(row).canAccessAnalytics).toBe(true);
  });

  it("clears the grace clock, so the sweep cannot re-freeze them", async () => {
    // Left set, the next sweep sees a tenant whose grace window began three
    // days ago and freezes them — undoing the extension without a word.
    const business = await lapsed();
    await extendTrial(db, business.id, 7, new Date());

    expect((await getBusinessById(db, business.id))?.graceStartedAt).toBeNull();
  });

  it("measures the new window from today, not from the date that passed", async () => {
    const business = await lapsed();
    const now = new Date();

    await extendTrial(db, business.id, 7, now);

    const trialEndsAt = (await getBusinessById(db, business.id))!.trialEndsAt!;
    const daysOut = (trialEndsAt.getTime() - now.getTime()) / DAY;
    expect(daysOut).toBeGreaterThan(6.9);
    expect(daysOut).toBeLessThan(7.1);
  });

  it("lifts a billing freeze, because that is what the extension is for", async () => {
    const business = await tenant({
      subscriptionStatus: "past_due",
      isActive: false,
      frozenReason: "billing",
    });

    await extendTrial(db, business.id, 7, new Date());

    const row = (await getBusinessById(db, business.id))!;
    expect(row.isActive).toBe(true);
    expect(row.frozenReason).toBeNull();
    expect(effectivePlan(row)).toBe("pro");
  });

  /**
   * The asymmetry that keeps the two controls separate. An admin froze this
   * tenant deliberately; undoing that as a side effect of extending a trial
   * would make a support action quietly reverse a moderation one.
   */
  it("leaves an admin freeze exactly where it was", async () => {
    const business = await tenant({
      subscriptionStatus: "past_due",
      isActive: false,
      frozenReason: "admin",
    });

    await extendTrial(db, business.id, 7, new Date());

    const row = (await getBusinessById(db, business.id))!;
    expect(row.isActive).toBe(false);
    expect(row.frozenReason).toBe("admin");
    // Still served nothing — the trial clock moved, the freeze did not.
    expect(effectivePlan(row)).toBe("free");
  });

  it("reports a missing tenant rather than silently doing nothing", async () => {
    expect(await extendTrial(db, randomUUID(), 7, new Date())).toBeNull();
  });
});
