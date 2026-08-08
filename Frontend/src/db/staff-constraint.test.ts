import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The double-booking guard, after 0013 rekeyed it on `(business_id, staff_id)`.
 *
 * This is the one invariant application code cannot re-derive — two clients
 * tapping the same slot at the same instant beat any availability check — so it
 * is asserted against real Postgres rather than reasoned about.
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

const AT = new Date("2026-09-07T09:00:00Z");
const UNTIL = new Date("2026-09-07T10:00:00Z");

async function shop() {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 60 });
  return { business, service };
}

describe("appointments_no_overlap_staff", () => {
  it("still refuses two overlapping bookings for the same provider", () => {
    return (async () => {
      const { business, service } = await shop();
      const [alice] = await db.query.staff.findMany({
        where: (s, { eq }) => eq(s.businessId, business.id),
      });

      await createAppointment(db, business.id, service.id, AT, UNTIL, {
        staffId: alice.id,
      });

      await expect(
        createAppointment(db, business.id, service.id, AT, UNTIL, {
          staffId: alice.id,
        }),
      ).rejects.toThrow();
    })();
  });

  it("allows the same time for two different providers", async () => {
    // The entire point of the feature. Before 0013 the constraint keyed on
    // business_id alone, so this insert was refused.
    const { business, service } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq, and, ne }) =>
        and(eq(s.businessId, business.id), ne(s.id, bob.id)),
    });

    await createAppointment(db, business.id, service.id, AT, UNTIL, {
      staffId: alice.id,
    });

    const second = await createAppointment(
      db,
      business.id,
      service.id,
      AT,
      UNTIL,
      { staffId: bob.id },
    );

    expect(second.staffId).toBe(bob.id);
  });

  it("keeps back-to-back bookings legal for one provider", async () => {
    // The half-open range survived the rekey.
    const { business, service } = await shop();
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    await createAppointment(db, business.id, service.id, AT, UNTIL, {
      staffId: alice.id,
    });

    const next = await createAppointment(
      db,
      business.id,
      service.id,
      UNTIL,
      new Date(UNTIL.getTime() + 3_600_000),
      { staffId: alice.id },
    );

    expect(next.id).toBeTruthy();
  });

  it("frees the slot again when a booking is cancelled", async () => {
    const { business, service } = await shop();
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    await createAppointment(db, business.id, service.id, AT, UNTIL, {
      staffId: alice.id,
      status: "cancelled",
    });

    const replacement = await createAppointment(
      db,
      business.id,
      service.id,
      AT,
      UNTIL,
      { staffId: alice.id },
    );

    expect(replacement.id).toBeTruthy();
  });

  it("does not let one tenant's provider block another's", async () => {
    const a = await shop();
    const b = await shop();

    const [aliceA] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, a.business.id),
    });
    const [aliceB] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, b.business.id),
    });

    await createAppointment(db, a.business.id, a.service.id, AT, UNTIL, {
      staffId: aliceA.id,
    });
    const other = await createAppointment(
      db,
      b.business.id,
      b.service.id,
      AT,
      UNTIL,
      { staffId: aliceB.id },
    );

    expect(other.id).toBeTruthy();
  });
});

describe("deposit statuses hold their slot", () => {
  // 0014 adds `pending_deposit` and `pending_approval` without naming them in
  // the exclusion predicate — 0013 stated it as "not one of the terminal
  // statuses" precisely so it could not. That indirection is the thing worth
  // testing: if it were wrong, two clients could each be told to transfer money
  // for the same time, and the slower one would find it gone having paid.
  it.each(["pending_deposit", "pending_approval"] as const)(
    "blocks an overlapping booking while %s",
    async (status) => {
      const { business, service } = await shop();
      const [alice] = await db.query.staff.findMany({
        where: (s, { eq }) => eq(s.businessId, business.id),
      });

      await createAppointment(db, business.id, service.id, AT, UNTIL, {
        staffId: alice.id,
        status,
      });

      await expect(
        createAppointment(db, business.id, service.id, AT, UNTIL, {
          staffId: alice.id,
        }),
      ).rejects.toThrow();
    },
  );

  it.each(["cancelled", "completed", "no_show"] as const)(
    "releases the slot when %s",
    async (status) => {
      const { business, service } = await shop();
      const [alice] = await db.query.staff.findMany({
        where: (s, { eq }) => eq(s.businessId, business.id),
      });

      await createAppointment(db, business.id, service.id, AT, UNTIL, {
        staffId: alice.id,
        status,
      });

      const replacement = await createAppointment(
        db,
        business.id,
        service.id,
        AT,
        UNTIL,
        { staffId: alice.id },
      );

      expect(replacement.id).toBeTruthy();
    },
  );
});

describe("the backfill invariant", () => {
  it("gives every new business exactly one staff member", async () => {
    // `appointments.staff_id` is NOT NULL, so a business without one cannot
    // take a booking at all.
    const business = await createBusiness(db);
    const team = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    expect(team).toHaveLength(1);
    expect(team[0].name).toBe(business.name);
    expect(team[0].isActive).toBe(true);
  });

  it("refuses to delete a provider who holds history", async () => {
    // RESTRICT, not CASCADE: an appointment is the record that someone was
    // seen, and it must outlive the staff row.
    const { business, service } = await shop();
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    await createAppointment(db, business.id, service.id, AT, UNTIL, {
      staffId: alice.id,
    });

    await expect(
      harness.pg.query(`DELETE FROM staff WHERE id = '${alice.id}'`),
    ).rejects.toThrow();
  });
});
