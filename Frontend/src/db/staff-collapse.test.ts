import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deactivateSecondaryStaff, listActiveStaff } from "@/db/queries/staff";
import { staff } from "@/db/schema";
import type { Database } from "@/db/types";
import { createBusiness, createStaff } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * Collapsing a team back to one chair, and **who survives it**.
 *
 * ---------------------------------------------------------------------------
 * Turning the multi-provider switch off is the one destructive thing on the
 * staff page, and what it destroys is somebody's place on the rota. The rule is
 * seniority — earliest `created_at` — and it is deliberately *not*
 * `primaryStaff()`, which leads with `sortOrder` and therefore with however the
 * owner last arranged the list.
 *
 * That difference is invisible on nearly every shop, because `sortOrder`
 * defaults to `0` and the tie then breaks on `createdAt` anyway. It appears
 * only where somebody has been dragged to the top, which is exactly the case a
 * test has to hold: the two rules agree everywhere else, so nothing else would
 * ever catch a regression back to display order.
 * ---------------------------------------------------------------------------
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

const AUGUST = (day: number) =>
  new Date(`2026-08-${String(day).padStart(2, "0")}T09:00:00Z`);

/**
 * A shop whose roster is exactly what the test declares.
 *
 * `createBusiness` inserts one provider of its own — correctly, because a
 * business with none cannot take a booking and the factory refuses to build a
 * tenant the schema forbids. It is cleared here so seniority is decided by the
 * timestamps each test sets rather than by a row it never mentioned: that
 * default arrives with `now()`, which is *later* than the historical dates
 * below and would quietly sit at the wrong end of the ordering.
 *
 * Safe to delete rather than deactivate — it holds no appointments, so the
 * `ON DELETE RESTRICT` on `appointments.staff_id` has nothing to refuse.
 */
async function emptyShop() {
  const business = await createBusiness(db);
  await db.delete(staff).where(eq(staff.businessId, business.id));
  return business;
}

describe("deactivateSecondaryStaff", () => {
  it("keeps the longest-serving provider and deactivates the rest", async () => {
    const business = await emptyShop();
    const senior = await createStaff(db, business.id, {
      name: "ותיק",
      createdAt: AUGUST(1),
    });
    await createStaff(db, business.id, { name: "חדש", createdAt: AUGUST(20) });
    await createStaff(db, business.id, { name: "חדש יותר", createdAt: AUGUST(25) });

    const moved = await deactivateSecondaryStaff(db, business.id);

    expect(moved).toBe(2);
    const active = await listActiveStaff(db, business.id);
    expect(active.map((m) => m.id)).toEqual([senior.id]);
  });

  it("keeps seniority even when a newer provider was sorted to the top", async () => {
    /**
     * The assertion the whole rule change exists for.
     *
     * `primaryStaff()` would answer "the one at position 0" and keep the
     * newcomer, because `sortOrder` outranks `createdAt` in that ordering. An
     * owner can rearrange a list by accident; they cannot rearrange who has
     * been there longest.
     */
    const business = await emptyShop();
    const senior = await createStaff(db, business.id, {
      name: "ותיק",
      createdAt: AUGUST(1),
      sortOrder: 5,
    });
    const newcomerOnTop = await createStaff(db, business.id, {
      name: "חדש",
      createdAt: AUGUST(20),
      sortOrder: 0,
    });

    // Precondition: display order really does disagree, or this proves nothing.
    const before = await listActiveStaff(db, business.id);
    expect(before[0].id).toBe(newcomerOnTop.id);

    await deactivateSecondaryStaff(db, business.id);

    const active = await listActiveStaff(db, business.id);
    expect(active.map((m) => m.id)).toEqual([senior.id]);
  });

  it("leaves a one-chair shop untouched and reports nothing moved", async () => {
    // The caller phrases its message on this count, and a shop that was already
    // single-staff must not be told somebody was moved off the rota.
    const business = await emptyShop();
    const only = await createStaff(db, business.id, { name: "יחיד" });

    expect(await deactivateSecondaryStaff(db, business.id)).toBe(0);
    expect((await listActiveStaff(db, business.id)).map((m) => m.id)).toEqual([
      only.id,
    ]);
  });

  it("never empties the roster, whatever the timestamps look like", async () => {
    /**
     * A tenant with no active provider takes no bookings at all, and does so
     * silently — availability just returns an empty list for every day. Two
     * rows created in the same statement share a timestamp to the microsecond,
     * which is the shape most likely to confuse a "keep the smallest" rule.
     */
    const business = await emptyShop();
    const sameInstant = AUGUST(3);
    await createStaff(db, business.id, { name: "א", createdAt: sameInstant });
    await createStaff(db, business.id, { name: "ב", createdAt: sameInstant });

    await deactivateSecondaryStaff(db, business.id);

    const active = await listActiveStaff(db, business.id);
    expect(active).toHaveLength(1);
  });

  it("ignores providers who are already inactive", async () => {
    // They are not on the rota, so they are not "moved off" it — counting them
    // would report two people deactivated when one was already gone.
    const business = await emptyShop();
    await createStaff(db, business.id, { name: "ותיק", createdAt: AUGUST(1) });
    await createStaff(db, business.id, { name: "פעיל", createdAt: AUGUST(10) });
    await createStaff(db, business.id, {
      name: "כבוי",
      createdAt: AUGUST(2),
      isActive: false,
    });

    expect(await deactivateSecondaryStaff(db, business.id)).toBe(1);
  });
});
