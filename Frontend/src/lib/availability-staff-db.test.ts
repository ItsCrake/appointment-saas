import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@/db/types";
import {
  getAvailableSlotsWithStaff,
  staffAvailableAt,
  weekdayOf,
} from "@/lib/availability";
import {
  createAppointment,
  createBusiness,
  createService,
  createShift,
  createStaff,
  createStaffSchedule,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The staff-aware engine over the **real query path**, not the pure function.
 *
 * `availability-staff.test.ts` proves the algorithm; this proves the wiring —
 * that `staff_schedules` rows, `working_hours` rows and appointments across
 * different services are read, partitioned and combined the way the algorithm
 * assumes. Both bugs covered here were invisible to the pure tests because the
 * pure tests get to hand-build their inputs.
 */

const DATE = "2026-08-03";
const WEEKDAY = weekdayOf(DATE);
const NOW = new Date("2026-07-01T00:00:00Z");

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

/** Local wall clock on DATE as the UTC instant the engine returns. IDT = +03. */
const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`).toISOString();

async function shop() {
  const business = await createBusiness(db);
  // 09:00–17:00, the hours everything below is measured against.
  await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00");
  const [alice] = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.businessId, business.id),
  });
  return { business, alice };
}

const slotsFor = (businessId: string, serviceId: string) =>
  getAvailableSlotsWithStaff(db, {
    businessId,
    serviceId,
    date: DATE,
    now: NOW,
  });

/* -------------------------------------------------------------------------- */

describe("a booking blocks its provider across every service", () => {
  it("removes the time from a different service of the same duration", async () => {
    // The property an owner assumes without being told: one person cannot be in
    // two places, whatever the second booking is *for*. It holds because
    // availability partitions appointments by `staff_id` and never looks at
    // `service_id` — which is easy to break by "optimising" the fetch.
    const { business, alice } = await shop();
    const haircut = await createService(db, business.id, {
      name: "תספורת",
      durationMin: 60,
    });
    const beard = await createService(db, business.id, {
      name: "זקן",
      durationMin: 60,
    });

    await createAppointment(
      db,
      business.id,
      haircut.id,
      new Date(at("09:00")),
      new Date(at("10:00")),
      { staffId: alice.id },
    );

    const beardSlots = await slotsFor(business.id, beard.id);

    expect(beardSlots.map((s) => s.label)).not.toContain("09:00");
    expect(staffAvailableAt(beardSlots, at("09:00"))).toEqual([]);
    // The rest of the day is untouched — this blocks a time, not a service.
    expect(beardSlots.map((s) => s.label)).toContain("10:00");
  });

  it("blocks every start a longer service would overlap", async () => {
    // A 30-minute booking at 09:30 has to remove the 09:00 start of a
    // 60-minute service too, not merely the identical time.
    const { business, alice } = await shop();
    const quick = await createService(db, business.id, {
      name: "עיצוב",
      durationMin: 30,
    });
    const long = await createService(db, business.id, {
      name: "צבע",
      durationMin: 60,
    });

    await createAppointment(
      db,
      business.id,
      quick.id,
      new Date(at("09:30")),
      new Date(at("10:00")),
      { staffId: alice.id },
    );

    const longSlots = await slotsFor(business.id, long.id);

    expect(staffAvailableAt(longSlots, at("09:00"))).toEqual([]);
    expect(staffAvailableAt(longSlots, at("10:00"))).toEqual([alice.id]);
  });

  it("blocks only that provider, leaving the time open on another", async () => {
    const { business, alice } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const haircut = await createService(db, business.id, { durationMin: 60 });
    const beard = await createService(db, business.id, {
      name: "זקן",
      durationMin: 60,
    });

    await createAppointment(
      db,
      business.id,
      haircut.id,
      new Date(at("09:00")),
      new Date(at("10:00")),
      { staffId: alice.id },
    );

    // Still offered, because Bob is free — but Alice must not be among the
    // names, on either service.
    for (const service of [haircut, beard]) {
      const slots = await slotsFor(business.id, service.id);
      expect(staffAvailableAt(slots, at("09:00"))).toEqual([bob.id]);
    }
  });

  it("frees the time on every service once the booking is cancelled", async () => {
    const { business, alice } = await shop();
    const haircut = await createService(db, business.id, { durationMin: 60 });
    const beard = await createService(db, business.id, {
      name: "זקן",
      durationMin: 60,
    });

    await createAppointment(
      db,
      business.id,
      haircut.id,
      new Date(at("09:00")),
      new Date(at("10:00")),
      { staffId: alice.id, status: "cancelled" },
    );

    const slots = await slotsFor(business.id, beard.id);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([alice.id]);
  });

  it("keeps a pending-approval booking blocking, like the constraint does", async () => {
    // Availability derives its blocking set from the status enum rather than
    // listing it, so it cannot drift from the exclusion constraint. A booking
    // awaiting the owner's approval still holds its time.
    const { business, alice } = await shop();
    const haircut = await createService(db, business.id, { durationMin: 60 });
    const beard = await createService(db, business.id, {
      name: "זקן",
      durationMin: 60,
    });

    await createAppointment(
      db,
      business.id,
      haircut.id,
      new Date(at("09:00")),
      new Date(at("10:00")),
      { staffId: alice.id, status: "pending" },
    );

    const slots = await slotsFor(business.id, beard.id);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("staff_schedules never widen the shop's hours", () => {
  it("clips a personal shift that starts before opening and ends after closing", async () => {
    // The production bug, end to end: a `staff_schedules` row of 06:00–23:00
    // against `working_hours` of 09:00–17:00 used to be offered in full.
    const { business, alice } = await shop();
    const service = await createService(db, business.id, { durationMin: 60 });
    await createStaffSchedule(db, alice.id, WEEKDAY, "06:00:00", "23:00:00");

    const slots = await slotsFor(business.id, service.id);
    const labels = slots.map((s) => s.label);

    expect(labels[0]).toBe("09:00");
    expect(labels[labels.length - 1]).toBe("16:00");
    expect(labels).not.toContain("06:00");
    expect(labels).not.toContain("22:00");
  });

  it("offers nothing on a weekday the shop has no hours for", async () => {
    const business = await createBusiness(db);
    const service = await createService(db, business.id, { durationMin: 60 });
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });
    // No `working_hours` row at all for this weekday — the shop is shut.
    await createStaffSchedule(db, alice.id, WEEKDAY, "09:00:00", "17:00:00");

    expect(await slotsFor(business.id, service.id)).toEqual([]);
  });

  it("still narrows within the shop's hours, which is what the feature is for", async () => {
    // The fix must not flatten personal schedules into "everyone works the
    // shop's hours" — a morning-only barber is the whole point of the table.
    const { business, alice } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });
    await createStaffSchedule(db, alice.id, WEEKDAY, "09:00:00", "11:00:00");

    const slots = await slotsFor(business.id, service.id);

    expect(staffAvailableAt(slots, at("09:00")).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
    // Alice is gone after 11:00; Bob inherits the shop's hours and stays.
    expect(staffAvailableAt(slots, at("14:00"))).toEqual([bob.id]);
  });

  it("respects a day the shop has explicitly marked closed", async () => {
    const business = await createBusiness(db);
    const service = await createService(db, business.id, { durationMin: 60 });
    const [alice] = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00", true);
    await createStaffSchedule(db, alice.id, WEEKDAY, "09:00:00", "17:00:00");

    expect(await slotsFor(business.id, service.id)).toEqual([]);
  });
});
