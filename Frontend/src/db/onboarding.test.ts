import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  completeOnboarding,
  getBusinessByOwner,
  isSlugTaken,
  listServices,
  listWorkingHours,
  replaceWorkingHours,
  updateBusiness,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { createBusiness, createService as makeService } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

describe("onboarding state", () => {
  it("starts incomplete, which is what routes an owner into the flow", async () => {
    const business = await createBusiness(db);
    expect(business.onboardingCompletedAt).toBeNull();
  });

  it("marks completion with a timestamp", async () => {
    const business = await createBusiness(db);
    const at = new Date("2026-08-05T12:00:00Z");

    const done = await completeOnboarding(db, business.id, at);
    expect(done?.onboardingCompletedAt?.toISOString()).toBe(at.toISOString());
  });

  it("is idempotent — a second call does not move the timestamp", async () => {
    const business = await createBusiness(db);
    const first = new Date("2026-08-05T12:00:00Z");
    await completeOnboarding(db, business.id, first);

    const second = await completeOnboarding(
      db,
      business.id,
      new Date("2026-09-01T12:00:00Z"),
    );
    expect(second).toBeNull(); // nothing matched, so nothing was updated

    const [row] = await harness.pg
      .query<{ onboarding_completed_at: string }>(
        `SELECT onboarding_completed_at FROM businesses WHERE id = '${business.id}'`,
      )
      .then((r) => r.rows);
    expect(new Date(row.onboarding_completed_at).toISOString()).toBe(
      first.toISOString(),
    );
  });

  it("survives deleting every service — the whole point of explicit state", async () => {
    const business = await createBusiness(db);
    const service = await makeService(db, business.id);
    await completeOnboarding(db, business.id);

    await harness.pg.exec(`DELETE FROM services WHERE id = '${service.id}'`);

    const after = await getBusinessByOwner(db, business.ownerUserId);
    expect(await listServices(db, business.id)).toHaveLength(0);
    // Inferring completion from service count would drag them back to setup.
    expect(after?.onboardingCompletedAt).not.toBeNull();
  });
});

describe("setup step 1 — business details", () => {
  it("allows re-saving the same slug for the same business", async () => {
    const business = await createBusiness(db, { slug: "ron-barber" });

    // Editing step 1 and resubmitting must not trip the uniqueness check.
    expect(await isSlugTaken(db, "ron-barber", business.id)).toBe(false);

    const updated = await updateBusiness(db, business.id, {
      name: "מספרת רון החדשה",
      slug: "ron-barber",
    });
    expect(updated?.name).toBe("מספרת רון החדשה");
  });

  it("still blocks a slug another business already holds", async () => {
    await createBusiness(db, { slug: "taken" });
    const mine = await createBusiness(db, { slug: "mine" });

    expect(await isSlugTaken(db, "taken", mine.id)).toBe(true);
  });

  it("keeps one business per owner across a re-submit", async () => {
    const ownerUserId = randomUUID();
    const business = await createBusiness(db, { ownerUserId });

    await updateBusiness(db, business.id, { name: "שם מעודכן" });

    const found = await getBusinessByOwner(db, ownerUserId);
    expect(found?.id).toBe(business.id);
    expect(found?.name).toBe("שם מעודכן");
  });
});

describe("setup step 3 — hours", () => {
  it("replaces the seeded default week with the owner's edit", async () => {
    const business = await createBusiness(db);

    await replaceWorkingHours(db, business.id, [
      { weekday: 0, startTime: "09:00:00", endTime: "17:00:00" },
      { weekday: 1, startTime: "09:00:00", endTime: "17:00:00" },
    ]);
    expect(await listWorkingHours(db, business.id)).toHaveLength(2);

    await replaceWorkingHours(db, business.id, [
      { weekday: 0, startTime: "10:00:00", endTime: "14:00:00" },
      { weekday: 0, startTime: "16:00:00", endTime: "20:00:00" },
      { weekday: 5, startTime: "09:00:00", endTime: "13:00:00" },
    ]);

    const rows = await listWorkingHours(db, business.id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.weekday === 0)).toHaveLength(2); // split shift
    expect(rows.some((r) => r.weekday === 1)).toBe(false); // old row gone
  });
});
