import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBusinessById, setTenantPlan } from "@/db/queries";
import type { Database } from "@/db/types";
import { entitlementsFor } from "@/lib/entitlements";
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
