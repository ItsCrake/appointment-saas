import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listFreedSlots,
  listInvitedSlotStarts,
  listWaitlistEntries,
  markWaitlistInvited,
  setWaitlistStatus,
  updateAppointmentStatus,
  upsertWaitlistEntry,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { weekdayOf } from "@/lib/availability";
import {
  createAppointment,
  createBusiness,
  createService,
  createShift,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The waitlist over the real query path.
 *
 * `waitlist.test.ts` proves the matching rule; this proves the things only a
 * database can answer — the partial unique index, what a second join does to a
 * live entry, and whether a freed slot is actually findable once an appointment
 * is cancelled through the same call the dashboard uses.
 */

const DATE = "2026-08-04";
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

const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`);

async function shop() {
  const business = await createBusiness(db);
  await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00");
  const service = await createService(db, business.id, { durationMin: 60 });
  return { business, service };
}

const join = (businessId: string, overrides: Record<string, unknown> = {}) =>
  upsertWaitlistEntry(db, {
    businessId,
    clientName: "דני",
    clientPhone: "0500000001",
    serviceId: null,
    preferredStaffId: null,
    preferredDays: [],
    preferredTimeWindow: "any",
    notes: null,
    ...overrides,
  });

describe("joining the queue", () => {
  it("stores the preferences as given", async () => {
    const { business, service } = await shop();

    const { row, rejoined } = await join(business.id, {
      serviceId: service.id,
      preferredDays: [0, 2],
      preferredTimeWindow: "morning",
    });

    expect(rejoined).toBe(false);
    expect(row.status).toBe("active");
    expect(row.preferredDays).toEqual([0, 2]);
    expect(row.preferredTimeWindow).toBe("morning");
  });

  it("updates the place somebody already holds instead of failing", async () => {
    // A partial unique index allows one live entry per phone per shop, so a
    // second join has to be a correction rather than a constraint violation.
    const { business } = await shop();

    const first = await join(business.id, { preferredTimeWindow: "morning" });
    const second = await join(business.id, {
      clientName: "דני כהן",
      preferredTimeWindow: "evening",
    });

    expect(second.rejoined).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.preferredTimeWindow).toBe("evening");
    expect(second.row.clientName).toBe("דני כהן");

    // And the wait is not restarted — the whole point of updating in place.
    expect(second.row.createdAt.getTime()).toBe(first.row.createdAt.getTime());

    expect(await listWaitlistEntries(db, business.id)).toHaveLength(1);
  });

  it("lets somebody join again once their previous entry is closed", async () => {
    // The index is partial on the live statuses, so history does not block a
    // returning client.
    const { business } = await shop();

    const first = await join(business.id);
    await setWaitlistStatus(db, first.row.id, "booked");

    const second = await join(business.id);

    expect(second.rejoined).toBe(false);
    expect(second.row.id).not.toBe(first.row.id);
  });

  it("keeps two shops' queues apart", async () => {
    const a = await shop();
    const b = await shop();

    await join(a.business.id);
    await join(b.business.id);

    expect(await listWaitlistEntries(db, a.business.id)).toHaveLength(1);
    expect(await listWaitlistEntries(db, b.business.id)).toHaveLength(1);
  });
});

describe("finding a freed slot", () => {
  it("surfaces a future appointment cancelled through the dashboard", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    // Cancelled the way the dashboard does it, which is what stamps
    // `cancelled_at` — the column the banner filters on.
    await updateAppointmentStatus(db, business.id, booking.id, "cancelled");

    const freed = await listFreedSlots(db, business.id, {
      since: new Date(Date.now() - 86_400_000),
      now: NOW,
    });

    expect(freed).toHaveLength(1);
    expect(freed[0].appointment.id).toBe(booking.id);
  });

  it("ignores a slot that has already passed", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );
    await updateAppointmentStatus(db, business.id, booking.id, "cancelled");

    const freed = await listFreedSlots(db, business.id, {
      since: new Date(Date.now() - 86_400_000),
      // A clock after the appointment: nobody can take a slot that has gone.
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(freed).toEqual([]);
  });

  it("ignores a live booking, and one restored after cancelling", async () => {
    const { business, service } = await shop();
    const booking = await createAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const range = { since: new Date(Date.now() - 86_400_000), now: NOW };
    expect(await listFreedSlots(db, business.id, range)).toEqual([]);

    await updateAppointmentStatus(db, business.id, booking.id, "cancelled");
    expect(await listFreedSlots(db, business.id, range)).toHaveLength(1);

    // Restoring clears the stamp, so the opening stops being announced.
    await updateAppointmentStatus(db, business.id, booking.id, "confirmed");
    expect(await listFreedSlots(db, business.id, range)).toEqual([]);
  });
});

describe("offering a slot", () => {
  it("records the offer and marks the slot as already handled", async () => {
    const { business, service } = await shop();
    const { row } = await join(business.id);

    const staffRows = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    const invited = await markWaitlistInvited(db, row.id, {
      inviteToken: "token-1",
      invitedStartsAt: at("10:00"),
      invitedEndsAt: at("11:00"),
      invitedStaffId: staffRows[0].id,
      invitedServiceId: service.id,
    });

    expect(invited?.status).toBe("notified");
    expect(invited?.inviteToken).toBe("token-1");

    // The banner uses this to stop re-announcing an opening already acted on.
    const handled = await listInvitedSlotStarts(db, business.id);
    expect(handled.has(at("10:00").getTime())).toBe(true);
  });

  it("retires the token when the entry leaves the queue", async () => {
    // What stops a used or withdrawn link from resolving at all.
    const { business, service } = await shop();
    const { row } = await join(business.id);
    const staffRows = await db.query.staff.findMany({
      where: (s, { eq }) => eq(s.businessId, business.id),
    });

    await markWaitlistInvited(db, row.id, {
      inviteToken: "token-2",
      invitedStartsAt: at("10:00"),
      invitedEndsAt: at("11:00"),
      invitedStaffId: staffRows[0].id,
      invitedServiceId: service.id,
    });

    const booked = await setWaitlistStatus(db, row.id, "booked", {
      clearInvite: true,
    });

    expect(booked?.status).toBe("booked");
    expect(booked?.inviteToken).toBeNull();
  });
});
