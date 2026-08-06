import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { businesses, invoices, subscriptionEvents } from "@/db/schema";
import {
  activateSubscription,
  cancelAtPeriodEnd,
} from "@/lib/billing/activate";
import { createBusiness } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

let harness: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  harness = await createTestDb();
});

afterAll(async () => {
  await harness.close();
});

const NOW = new Date("2026-08-10T09:00:00Z");

const activate = (businessId: string, overrides = {}) =>
  activateSubscription(harness.db, {
    businessId,
    plan: "pro",
    cycle: "monthly",
    amountCents: 9900,
    provider: "console",
    providerRef: `ref_${businessId}`,
    now: NOW,
    ...overrides,
  });

const reload = async (id: string) => {
  const [row] = await harness.db
    .select()
    .from(businesses)
    .where(eq(businesses.id, id));
  return row;
};

describe("activateSubscription", () => {
  it("moves a trialing tenant to active and stops every clock", async () => {
    const business = await createBusiness(harness.db, {
      subscriptionStatus: "trialing",
      planType: "starter",
      trialEndsAt: new Date("2026-08-12T09:00:00Z"),
      graceStartedAt: new Date("2026-08-01T09:00:00Z"),
    });

    await activate(business.id);
    const row = await reload(business.id);

    expect(row.subscriptionStatus).toBe("active");
    expect(row.planType).toBe("pro");
    expect(row.billingCycle).toBe("monthly");
    expect(row.cancelAtPeriodEnd).toBe(false);
    // Left set, the sweep would freeze a tenant who has just paid.
    expect(row.graceStartedAt).toBeNull();
    expect(row.currentPeriodEnd?.toISOString()).toBe(
      "2026-09-10T09:00:00.000Z",
    );
  });

  it("advances a year for a yearly cycle", async () => {
    const business = await createBusiness(harness.db);
    await activate(business.id, { cycle: "yearly", amountCents: 99000 });

    const row = await reload(business.id);
    expect(row.currentPeriodEnd?.toISOString()).toBe(
      "2027-08-10T09:00:00.000Z",
    );
  });

  it("writes one paid invoice and one processed event", async () => {
    const business = await createBusiness(harness.db);
    await activate(business.id);

    const bills = await harness.db
      .select()
      .from(invoices)
      .where(eq(invoices.businessId, business.id));
    expect(bills).toHaveLength(1);
    expect(bills[0].status).toBe("paid");
    expect(bills[0].amountCents).toBe(9900);

    const events = await harness.db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.businessId, business.id));
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("processed");
  });

  it("is idempotent on a repeated provider reference", async () => {
    const business = await createBusiness(harness.db);

    // A provider retrying its webhook must not bill the tenant twice.
    await activate(business.id);
    await activate(business.id);

    const bills = await harness.db
      .select()
      .from(invoices)
      .where(eq(invoices.businessId, business.id));
    const events = await harness.db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.businessId, business.id));

    expect(bills).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("lifts a billing freeze", async () => {
    const business = await createBusiness(harness.db, {
      isActive: false,
      frozenReason: "billing",
      subscriptionStatus: "past_due",
      graceStartedAt: new Date("2026-07-20T09:00:00Z"),
    });

    const result = await activate(business.id);
    const row = await reload(business.id);

    expect(result?.unfrozen).toBe(true);
    expect(row.isActive).toBe(true);
    expect(row.frozenReason).toBeNull();
  });

  it("never lifts an admin freeze", async () => {
    // Otherwise a tenant frozen for abuse could buy their way back in.
    const business = await createBusiness(harness.db, {
      isActive: false,
      frozenReason: "admin",
    });

    const result = await activate(business.id);
    const row = await reload(business.id);

    expect(result?.unfrozen).toBe(false);
    expect(row.isActive).toBe(false);
    expect(row.frozenReason).toBe("admin");
    // The subscription still activates: they paid, they are simply still
    // frozen for an unrelated reason.
    expect(row.subscriptionStatus).toBe("active");
  });

  it("returns null for a business that does not exist", async () => {
    const missing = await activateSubscription(harness.db, {
      businessId: "00000000-0000-0000-0000-000000000000",
      plan: "pro",
      cycle: "monthly",
      amountCents: 9900,
      provider: "console",
      providerRef: "ref_missing",
    });
    expect(missing).toBeNull();
  });
});

describe("cancelAtPeriodEnd", () => {
  it("records the intent without revoking access", async () => {
    const business = await createBusiness(harness.db);
    await activate(business.id);

    await cancelAtPeriodEnd(harness.db, business.id, true);
    const row = await reload(business.id);

    expect(row.cancelAtPeriodEnd).toBe(true);
    // They paid through the period, so nothing is taken away yet.
    expect(row.subscriptionStatus).toBe("active");
    expect(row.isActive).toBe(true);
  });

  it("can be turned back off", async () => {
    const business = await createBusiness(harness.db);
    await cancelAtPeriodEnd(harness.db, business.id, true);
    await cancelAtPeriodEnd(harness.db, business.id, false);

    expect((await reload(business.id)).cancelAtPeriodEnd).toBe(false);
  });
});
