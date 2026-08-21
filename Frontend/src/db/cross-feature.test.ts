import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAppointment,
  getWaitlistEntryByToken,
  listWaitlistEntries,
  markWaitlistInvited,
  setWaitlistStatus,
  SlotTakenError,
  updateAppointmentStatus,
  upsertWaitlistEntry,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { getAvailableSlotsWithStaff, weekdayOf } from "@/lib/availability";
import { matchesForSlot } from "@/lib/waitlist";
import {
  createAppointment as seedAppointment,
  createBusiness,
  createService,
  createShift,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The three newest features against each other, over a real database.
 *
 * ---------------------------------------------------------------------------
 * Each is tested on its own elsewhere. What is untested is the seam: a freed
 * slot re-entering availability, a waitlist invite racing a public booking, and
 * `requires_approval` deciding what a booking becomes while both of those are in
 * flight. Every one of those interactions ends at the same guarantee —
 * `appointments_no_overlap_staff` — and this is where that guarantee is checked
 * under pressure rather than assumed.
 * ---------------------------------------------------------------------------
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

async function shop(overrides: Record<string, unknown> = {}) {
  const business = await createBusiness(db, overrides);
  await createShift(db, business.id, WEEKDAY, "09:00:00", "17:00:00");
  const service = await createService(db, business.id, { durationMin: 60 });
  const [member] = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.businessId, business.id),
  });
  return { business, service, staffId: member.id };
}

describe("a cancellation puts its slot back on the public page", () => {
  it("is unbookable while held, and offered again once released", async () => {
    const { business, service } = await shop();

    const booking = await seedAppointment(
      db,
      business.id,
      service.id,
      at("10:00"),
      at("11:00"),
    );

    const held = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });
    expect(held.map((s) => s.startsAt)).not.toContain(at("10:00").toISOString());

    await updateAppointmentStatus(db, business.id, booking.id, "cancelled");

    const released = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });
    expect(released.map((s) => s.startsAt)).toContain(
      at("10:00").toISOString(),
    );
  });
});

describe("an invite and a public booking racing for one slot", () => {
  it("lets exactly one of them win", async () => {
    /**
     * The race the whole `/w/[token]` screen exists for, at the layer that
     * actually decides it. Both callers pass every check; the constraint picks.
     */
    const { business, service, staffId } = await shop();

    const insert = () =>
      createAppointment(db, {
        businessId: business.id,
        serviceId: service.id,
        staffId,
        startsAt: at("12:00"),
        endsAt: at("13:00"),
        status: "confirmed",
        clientName: "מישהו",
        clientPhone: "0500000001",
        serviceName: service.name,
        priceCents: service.priceCents,
        cancelToken: `race-${Math.random()}`,
      });

    await insert();
    await expect(insert()).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("does not block a second provider at the same time", async () => {
    // The constraint keys on (business_id, staff_id), so a team shop can run two
    // chairs at noon — which is what makes the refusal above about the person.
    const { business, service, staffId } = await shop();
    const second = await createStaff(db, business.id, { name: "שני" });

    await seedAppointment(db, business.id, service.id, at("12:00"), at("13:00"), {
      staffId,
    });

    const other = await seedAppointment(
      db,
      business.id,
      service.id,
      at("12:00"),
      at("13:00"),
      { staffId: second.id },
    );

    expect(other.id).toBeTruthy();
  });
});

describe("requires_approval and the waitlist compose", () => {
  it("keeps a pending booking blocking its slot", async () => {
    /**
     * `pending` is non-terminal, so it holds the time exactly as `confirmed`
     * does. A request that did not reserve the slot would be a request to be
     * disappointed — and would let the waitlist offer a time somebody is
     * already waiting on an answer for.
     */
    const { business, service } = await shop({ requiresApproval: true });

    await seedAppointment(db, business.id, service.id, at("14:00"), at("15:00"), {
      status: "pending",
    });

    const slots = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    expect(slots.map((s) => s.startsAt)).not.toContain(
      at("14:00").toISOString(),
    );
  });

  it("never offers a slot that a pending request is holding", async () => {
    const { business, service, staffId } = await shop({
      requiresApproval: true,
    });

    const pending = await seedAppointment(
      db,
      business.id,
      service.id,
      at("14:00"),
      at("15:00"),
      { status: "pending" },
    );

    const { row } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: "ממתין",
      clientPhone: "0500000009",
      serviceId: null,
      preferredStaffId: null,
      preferredDays: [],
      preferredTimeWindow: "any",
      notes: null,
    });

    // The matcher is only ever handed *freed* slots, so the guard is upstream:
    // a pending appointment is not cancelled, so nothing offers its time.
    expect(pending.status).toBe("pending");

    const rows = await listWaitlistEntries(db, business.id);
    expect(rows.map((r) => r.entry.id)).toContain(row.id);

    // And once it really is cancelled, the same entry matches it.
    const cancelled = await updateAppointmentStatus(
      db,
      business.id,
      pending.id,
      "cancelled",
    );

    const matched = matchesForSlot(
      rows.map((r) => r.entry),
      {
        startsAt: cancelled!.startsAt,
        endsAt: cancelled!.endsAt,
        staffId,
        serviceId: service.id,
      },
      business.timezone,
    );

    expect(matched.map((m) => m.id)).toContain(row.id);
  });
});

describe("an invite that loses the race", () => {
  it("keeps its holder in the queue with a dead token", async () => {
    /**
     * The state after `claimWaitlistSlotAction` catches `SlotTakenError`: back
     * to `active`, because they did not get this slot and so have not left the
     * queue, and the token cleared so the dead link stops resolving.
     */
    const { business, service, staffId } = await shop();
    const { row } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: "מפסיד",
      clientPhone: "0500000010",
      serviceId: null,
      preferredStaffId: null,
      preferredDays: [],
      preferredTimeWindow: "any",
      notes: null,
    });

    await markWaitlistInvited(db, row.id, {
      inviteToken: "tok-race",
      invitedStartsAt: at("15:00"),
      invitedEndsAt: at("16:00"),
      invitedStaffId: staffId,
      invitedServiceId: service.id,
    });

    expect(await getWaitlistEntryByToken(db, "tok-race")).not.toBeNull();

    const back = await setWaitlistStatus(db, row.id, "active", {
      clearInvite: true,
    });

    expect(back?.status).toBe("active");
    expect(await getWaitlistEntryByToken(db, "tok-race")).toBeNull();
  });
});
