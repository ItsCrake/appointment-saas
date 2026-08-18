import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  deletePendingNotificationsForAppointment,
  rescheduleAppointment,
  SlotTakenError,
  updateAppointmentDetails,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { getAvailableSlotsWithStaff, weekdayOf } from "@/lib/availability";
import { enqueueReminder } from "@/lib/notifications/enqueue";
import {
  createAppointment,
  createBusiness,
  createService,
  createShift,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * Moving an appointment.
 *
 * ---------------------------------------------------------------------------
 * Three properties, each of which was broken by the obvious implementation:
 *
 * 1. **A reschedule must not be blocked by the appointment it is moving.** The
 *    booking occupies the time it is moving *from*, so availability computed
 *    without excluding it reports its own slot as taken.
 * 2. **The move goes through the overlap constraint.** A bare UPDATE on
 *    `starts_at` would make the calendar the one route in the product that can
 *    double-book.
 * 3. **The reminder has to be re-planned, and the dedupe key gets in the way.**
 *    This is the one nobody would find by reading: marking the old reminder
 *    `skipped` and re-enqueueing silently queues *nothing*, because the key does
 *    not mention the time and `enqueueNotification` conflicts on it whatever the
 *    row's status.
 * ---------------------------------------------------------------------------
 */

const DATE = "2026-08-03";
const WEEKDAY = weekdayOf(DATE);
/** Long before DATE, so nothing is filtered for being in the past. */
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

/** Local wall clock on DATE as a UTC instant. IDT is +03. */
const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`);

async function shop() {
  const business = await createBusiness(db);
  await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00");
  const service = await createService(db, business.id, { durationMin: 60 });
  const [alice] = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.businessId, business.id),
  });
  return { business, service, alice };
}

/**
 * Moves a booking and insists it went somewhere, so the tests below can use the
 * returned row without a non-null assertion on every line.
 */
async function moveTo(
  businessId: string,
  appointmentId: string,
  from: string,
  to: string,
) {
  const moved = await rescheduleAppointment(db, businessId, appointmentId, {
    startsAt: at(from),
    endsAt: at(to),
  });
  if (!moved) throw new Error("the appointment did not move");
  return moved;
}

/* -------------------------------------------------------------------------- */

describe("availability excludes the appointment being moved", () => {
  it("offers the slot the appointment itself occupies", async () => {
    const { business, service } = await shop();

    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const withIt = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    const withoutIt = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
      excludeAppointmentId: booking.id,
    });

    const tenOClock = at("10:00").toISOString();

    // The whole point: 10:00 is unavailable *because of this booking*, so a
    // reschedule that keeps the hour and moves the minutes would be refused by
    // the very row it is moving.
    expect(withIt.map((slot) => slot.startsAt)).not.toContain(tenOClock);
    expect(withoutIt.map((slot) => slot.startsAt)).toContain(tenOClock);
  });

  it("still counts every other appointment as busy", async () => {
    const { business, service } = await shop();

    const mine = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );
    // Somebody else's, on the same provider.
    await createAppointment(
      db,
      business.id,
      service.id,
      at("12:00"),
      at("13:00"),
    );

    const slots = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
      excludeAppointmentId: mine.id,
    });

    const starts = slots.map((slot) => slot.startsAt);
    expect(starts).toContain(at("10:00").toISOString());
    expect(starts).not.toContain(at("12:00").toISOString());
  });
});

describe("the move itself", () => {
  it("moves an appointment onto free time", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const moved = await rescheduleAppointment(db, business.id, booking.id, {
      startsAt: at("14:00"),
      endsAt: at("15:00"),
    });

    expect(moved?.startsAt.toISOString()).toBe(at("14:00").toISOString());
    expect(moved?.endsAt.toISOString()).toBe(at("15:00").toISOString());
  });

  it("allows a move that overlaps the appointment's own former range", async () => {
    // An exclusion constraint never compares a row with itself, so nudging a
    // booking by fifteen minutes is not a conflict. Asserted because the
    // opposite would be a perfectly plausible way for this to fail.
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const moved = await rescheduleAppointment(db, business.id, booking.id, {
      startsAt: at("10:15"),
      endsAt: at("11:15"),
    });

    expect(moved?.startsAt.toISOString()).toBe(at("10:15").toISOString());
  });

  it("refuses to move onto another booking of the same provider", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );
    await createAppointment(db, business.id, service.id, at("12:00"), at("13:00"));

    await expect(
      rescheduleAppointment(db, business.id, booking.id, {
        startsAt: at("12:30"),
        endsAt: at("13:30"),
      }),
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("lets two providers hold the same hour", async () => {
    // The constraint keys on (business_id, staff_id), so a second chair is not
    // a clash — which is what makes the refusal above about the person and not
    // about the time.
    const { business, service, alice } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });

    await createAppointment(db, business.id, service.id, at("12:00"), at("13:00"), {
      staffId: alice.id,
    });
    const hers = await createAppointment(
      db,
      business.id,
      service.id,
      at("15:00"),
      at("16:00"),
      { staffId: bob.id },
    );

    const moved = await rescheduleAppointment(db, business.id, hers.id, {
      startsAt: at("12:00"),
      endsAt: at("13:00"),
      staffId: bob.id,
    });

    expect(moved?.startsAt.toISOString()).toBe(at("12:00").toISOString());
  });

  it("does not resolve another tenant's appointment", async () => {
    const { business, service } = await shop();
    const other = await createBusiness(db);
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const moved = await rescheduleAppointment(db, other.id, booking.id, {
      startsAt: at("14:00"),
      endsAt: at("15:00"),
    });

    expect(moved).toBeNull();
  });
});

describe("re-planning the reminder", () => {
  /**
   * The trap, asserted from both sides.
   *
   * `dedupe_key` is `reminder:<appointmentId>:<hoursBefore>` — it says nothing
   * about *when* the appointment is. Both times below are more than 24 hours
   * ahead, so both plan onto the 24-hour rule and both produce the same key.
   */
  it("queues nothing for the new time while the old row still holds the key", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
      { clientEmail: "client@example.test" },
    );

    expect(
      await enqueueReminder({ db, business, appointment: booking, now: NOW }),
    ).toEqual(["reminder"]);

    const moved = await moveTo(business.id, booking.id, "14:00", "15:00");

    // Skipping the old row — the intuitive thing — leaves the key taken, and
    // `enqueueNotification` is an onConflictDoNothing. The client would get no
    // reminder at all for the moved appointment, silently.
    await harness.pg.exec(
      `update notifications set status = 'skipped' where appointment_id = '${moved.id}'`,
    );

    expect(
      await enqueueReminder({ db, business, appointment: moved, now: NOW }),
    ).toEqual([]);
  });

  it("queues the new time once the pending row is deleted", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
      { clientEmail: "client@example.test" },
    );

    await enqueueReminder({ db, business, appointment: booking, now: NOW });

    const moved = await moveTo(business.id, booking.id, "14:00", "15:00");

    expect(await deletePendingNotificationsForAppointment(db, booking.id)).toBe(
      1,
    );
    expect(
      await enqueueReminder({ db, business, appointment: moved, now: NOW }),
    ).toEqual(["reminder"]);

    const rows = await db.query.notifications.findMany({
      where: (n, { eq }) => eq(n.appointmentId, booking.id),
    });

    // One reminder, and it fires 24 hours before the *new* start.
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledFor.toISOString()).toBe(
      new Date(at("14:00").getTime() - 24 * 3_600_000).toISOString(),
    );
  });

  it("leaves a reminder that already went out alone", async () => {
    // Only `pending` rows are dropped. A sent message is a record of something
    // that happened and deleting it would rewrite history.
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
      { clientEmail: "client@example.test" },
    );

    await enqueueReminder({ db, business, appointment: booking, now: NOW });
    await harness.pg.exec(
      `update notifications set status = 'sent' where appointment_id = '${booking.id}'`,
    );

    expect(await deletePendingNotificationsForAppointment(db, booking.id)).toBe(
      0,
    );

    const rows = await db.query.notifications.findMany({
      where: (n, { eq }) => eq(n.appointmentId, booking.id),
    });
    expect(rows).toHaveLength(1);
  });
});

describe("editing the details", () => {
  it("updates the name, phone and note without touching the times", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const updated = await updateAppointmentDetails(db, business.id, booking.id, {
      clientName: "רותם",
      clientPhone: "0521234567",
      notes: "מגיעה עם הבן",
    });

    expect(updated?.clientName).toBe("רותם");
    expect(updated?.clientPhone).toBe("0521234567");
    expect(updated?.notes).toBe("מגיעה עם הבן");
    // The snapshots and the times are none of this function's business.
    expect(updated?.startsAt.toISOString()).toBe(at("10:00").toISOString());
    expect(updated?.serviceName).toBe(booking.serviceName);
    expect(updated?.priceCents).toBe(booking.priceCents);
  });

  it("does not resolve another tenant's appointment", async () => {
    const { business, service } = await shop();
    const other = await createBusiness(db);
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    expect(
      await updateAppointmentDetails(db, other.id, booking.id, {
        clientName: "לא שלהם",
        clientPhone: "0500000000",
        notes: null,
      }),
    ).toBeNull();
  });
});
