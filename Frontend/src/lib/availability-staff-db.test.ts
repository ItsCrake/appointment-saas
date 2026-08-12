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

/**
 * `team: true` is the owner answering "yes" to the multi-staff setup question.
 * It is not decoration: with it off, availability evaluates **only** the primary
 * provider, so any test that expects a second name has to say it runs a team
 * shop. See "has_multiple_staff decides who is bookable" below.
 */
async function shop({ team = false }: { team?: boolean } = {}) {
  const business = await createBusiness(db, { hasMultipleStaff: team });
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
    const { business, alice } = await shop({ team: true });
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
    const { business, alice } = await shop({ team: true });
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

/* -------------------------------------------------------------------------- */

/**
 * A shop can hold more than one active staff row while answering "no" to the
 * multi-staff question, and that is a supported state rather than a corrupt
 * one: collapsing back to one chair deliberately does not delete people who
 * hold booking history. Before this, those people still shaped the public page.
 */
describe("has_multiple_staff decides who is bookable", () => {
  it("ignores a secondary provider's availability entirely", async () => {
    const { business, alice } = await shop();
    await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("09:00")),
      new Date(at("10:00")),
      { staffId: alice.id },
    );

    const slots = await slotsFor(business.id, service.id);

    // Bob is free at 09:00 and must not rescue the time: the one person this
    // shop books into is busy, so the shop is busy.
    expect(slots.map((s) => s.label)).not.toContain("09:00");
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([]);
  });

  it("never offers a secondary provider as the one taking the booking", async () => {
    const { business, alice } = await shop();
    await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });

    const slots = await slotsFor(business.id, service.id);

    // Every slot resolves to Alice alone. `createBookingAction` takes
    // `freeStaff[0]`, so a stray id here is a booking assigned to somebody the
    // owner stopped counting.
    for (const slot of slots) {
      expect(slot.staffIds).toEqual([alice.id]);
    }
  });

  it("does not let a secondary provider's hours widen the day", async () => {
    const { business } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });
    // Bob works late. With the concept switched off, that is not this shop's
    // problem — the page must still close when the shop does.
    await createStaffSchedule(db, bob.id, WEEKDAY, "09:00:00", "23:00:00");

    const labels = (await slotsFor(business.id, service.id)).map(
      (s) => s.label,
    );

    expect(labels[labels.length - 1]).toBe("16:00");
    expect(labels).not.toContain("20:00");
  });

  it("keeps one clean grid instead of interleaving two re-anchored ones", async () => {
    // The reported symptom, reproduced exactly: "the slots jump by five
    // minutes". Nothing was wrong with the step — it is `duration + buffer` and
    // always was. Each provider's cursor re-anchors on *their own* bookings, so
    // a colleague whose appointment ended at 09:05 contributed 09:05, 10:05 …
    // beside Alice's 09:00, 10:00 …, and the union interleaved them.
    const { business } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("09:00")),
      new Date(at("09:05")),
      { staffId: bob.id },
    );

    const labels = (await slotsFor(business.id, service.id)).map(
      (s) => s.label,
    );

    expect(labels).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
    ]);
    // The off-grid starts Bob's re-anchored cursor produced are gone with him.
    expect(labels.some((l) => l.endsWith(":05"))).toBe(false);
  });

  it("brings the whole team back the moment the toggle is on", async () => {
    // The other direction matters just as much: this is a setting an owner
    // flips, not a migration. Same fixture as above, one field different.
    const { business, alice } = await shop({ team: true });
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("09:00")),
      new Date(at("09:05")),
      { staffId: bob.id },
    );

    const slots = await slotsFor(business.id, service.id);
    const labels = slots.map((s) => s.label);

    /**
     * Bob is back — but on the shop's lattice, not on his own re-anchored one.
     *
     * This is the deliberate difference between the two modes. Bob's free time
     * genuinely starts at 09:05, and a one-chair shop would be offered exactly
     * that. On a team the first anchor at or after 09:05 is 09:15, because two
     * providers drifting independently is what produced the interleaved column
     * this engine exists to avoid.
     */
    expect(labels).not.toContain("09:05");
    expect(labels.slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);

    // Nobody is lost, only realigned: Alice alone at 09:00 because Bob is
    // busy, both of them from 09:15 on.
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([alice.id]);
    expect(staffAvailableAt(slots, at("09:15")).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The base grid, through the real query path.
 *
 * `availability-windows.test.ts` proves the lattice arithmetic on hand-built
 * inputs. This proves the wiring: that `has_multiple_staff` actually selects
 * the mode, that `slot_interval_min` actually reaches it, and that two
 * providers with unrelated busy days come back as one column of times.
 */
describe("multi-staff slots share one lattice", () => {
  it("aligns two providers whose free time starts at different minutes", async () => {
    const { business, alice } = await shop({ team: true });
    const bob = await createStaff(db, business.id, { name: "בוב" });
    const service = await createService(db, business.id, { durationMin: 60 });

    // Alice is free from 09:00; Bob's morning job ends at 09:20.
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("09:00")),
      new Date(at("09:20")),
      { staffId: bob.id },
    );

    const slots = await slotsFor(business.id, service.id);

    // Every offered time sits on the shop's 15-minute interval. Before the
    // grid this list also held 09:20, 10:20, 11:20 … from Bob's own
    // re-anchored walk, interleaved with Alice's on the hour.
    for (const slot of slots) {
      expect(["00", "15", "30", "45"]).toContain(slot.label.slice(3));
    }
    expect(slots.map((s) => s.label)).not.toContain("09:20");

    // Bob is realigned, not excluded.
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([alice.id]);
    expect(staffAvailableAt(slots, at("09:30")).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );
  });

  it("follows the tenant's own slot interval", async () => {
    // The column that had decayed into a setting which changed nothing. It is
    // load-bearing again, and only for team shops.
    const business = await createBusiness(db, {
      hasMultipleStaff: true,
      slotIntervalMin: 30,
    });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00");
    const service = await createService(db, business.id, { durationMin: 60 });

    const labels = (await slotsFor(business.id, service.id)).map(
      (s) => s.label,
    );

    expect(labels.slice(0, 4)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("fills a scattered day's gaps on the lattice", async () => {
    const { business } = await shop({ team: true });
    const service = await createService(db, business.id, { durationMin: 30 });

    // Two mid-day jobs on the only provider, with an hour between them.
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("10:00")),
      new Date(at("11:00")),
      {},
    );
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date(at("12:00")),
      new Date(at("13:00")),
      {},
    );

    const labels = (await slotsFor(business.id, service.id)).map(
      (s) => s.label,
    );

    // The 11:00–12:00 hole is offered at every anchor a 30-minute service
    // fits, and nothing that would run into the 12:00 booking.
    expect(labels).toContain("11:00");
    expect(labels).toContain("11:15");
    expect(labels).toContain("11:30");
    expect(labels).not.toContain("11:45");
    // And the booked hours themselves are gone.
    expect(labels).not.toContain("10:00");
    expect(labels).not.toContain("12:30");
  });
});
