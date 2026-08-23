import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getWaitlistEntry,
  listWaitlistEntries,
  upsertWaitlistEntry,
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";
import { offerSlotToWaitlist } from "@/lib/waitlist-offer";
import { runWaitlistOfferExpirySweep } from "@/lib/waitlist-expiry";

/**
 * The waitlist against the clock, at the edges a pilot shop will actually hit.
 *
 * ---------------------------------------------------------------------------
 * `waitlist.test.ts` proves the matching rule and `waitlist-expiry.test.ts`
 * proves the sweep. This is the third question: what happens when the times
 * involved are *close together* — a cancellation twenty minutes before the
 * slot, an offer whose window outlives the appointment it describes, a client
 * editing their preferences while an invite is already out.
 *
 * Every one of these is a real sequence a shop produces on a busy afternoon,
 * and none of them was covered.
 * ---------------------------------------------------------------------------
 */

const NOW = new Date("2027-03-02T09:00:00Z");

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

async function shop(waitlistOfferTtlMin = 60) {
  const business = await createBusiness(db, { waitlistOfferTtlMin });
  const service = await createService(db, business.id, { durationMin: 60 });
  const [member] = await listActiveStaff(db, business.id);
  return { business, service, staffId: member.id };
}

async function join(
  businessId: string,
  { phone, createdAt }: { phone: string; createdAt: Date },
) {
  const { row } = await upsertWaitlistEntry(db, {
    businessId,
    clientName: `לקוח ${phone.slice(-2)}`,
    clientPhone: phone,
    serviceId: null,
    preferredStaffId: null,
    preferredDays: [],
    preferredTimeWindow: "any",
    notes: null,
  });

  await harness.pg.query(
    `UPDATE waitlist_entries SET created_at = $1 WHERE id = $2`,
    [createdAt.toISOString(), row.id],
  );

  return row;
}

/** A freed slot `minutes` from `NOW`, one hour long. */
const slotIn = (minutes: number, staffId: string, serviceId: string) => ({
  startsAt: new Date(NOW.getTime() + minutes * 60_000),
  endsAt: new Date(NOW.getTime() + (minutes + 60) * 60_000),
  staffId,
  serviceId,
});

describe("a cancellation close to the slot", () => {
  it("still offers a slot twenty minutes away", async () => {
    /**
     * The most valuable cancellation a queue can be handed, and the easiest to
     * throw away. Twenty minutes is short, but a client already nearby will
     * take it — and the alternative is a chair sitting empty.
     */
    const { business, service, staffId } = await shop(60);
    await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(20, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBeTruthy();
  });

  it("clamps the offer window to the slot, not to the shop's hour", async () => {
    /**
     * The shop's window is sixty minutes and the slot is twenty away, so the
     * offer has to die in twenty — otherwise it outlives the appointment it
     * describes and the forty minutes that were left go to nobody.
     *
     * Swept at +25 minutes: past the slot, well inside the shop's hour.
     */
    const { business, service, staffId } = await shop(60);
    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(20, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "notified",
    );

    const summary = await runWaitlistOfferExpirySweep(db, {
      now: new Date(NOW.getTime() + 25 * 60_000),
    });

    expect(summary.expired).toBe(1);
    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "expired",
    );
  });

  it("offers nothing once the slot has started", async () => {
    // Tidying up a no-show after the fact is not an opening.
    const { business, service, staffId } = await shop(60);
    await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(-30, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBeNull();
  });

  it("expires an imminent offer at the slot even when the shop disabled the window", async () => {
    /**
     * `waitlist_offer_ttl_min = 0` switches off the *shop's* window. It does
     * not — and must not — make an offer immortal: the slot's own start is
     * still a deadline, because there is nothing left to accept.
     */
    const { business, service, staffId } = await shop(0);
    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(20, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    // Before the slot: untouched, because the shop set no window of its own.
    await runWaitlistOfferExpirySweep(db, {
      now: new Date(NOW.getTime() + 10 * 60_000),
    });
    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "notified",
    );

    // After it: gone, on the slot's authority rather than the shop's.
    await runWaitlistOfferExpirySweep(db, {
      now: new Date(NOW.getTime() + 25 * 60_000),
    });
    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "expired",
    );
  });
});

describe("editing preferences while an invite is out", () => {
  it("keeps the live invite and the original place in the queue", async () => {
    /**
     * Somebody is offered a slot, then edits their preferences before
     * answering — a completely ordinary sequence, and one with two ways to go
     * wrong: dropping them to the back of the queue, or silently killing the
     * offer they are in the middle of accepting.
     *
     * `upsertWaitlistEntry` touches neither `created_at` nor any `invited_*`
     * column, which is what makes both safe. Pinned because it is the kind of
     * thing a future "reset the entry on edit" change would quietly break.
     */
    const { business, service, staffId } = await shop(60);
    const original = await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(120, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    const invited = await getWaitlistEntry(db, business.id, original.id);
    expect(invited?.status).toBe("notified");

    const { rejoined } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: "שם מעודכן",
      clientPhone: "0500000001",
      serviceId: null,
      preferredStaffId: null,
      preferredDays: [1, 3],
      preferredTimeWindow: "evening",
      notes: "אחרי 18:00",
    });

    const after = await getWaitlistEntry(db, business.id, original.id);

    expect(rejoined).toBe(true);
    // The edit landed...
    expect(after?.preferredTimeWindow).toBe("evening");
    expect(after?.clientName).toBe("שם מעודכן");
    // ...without costing them their place, their status or their live link.
    expect(after?.createdAt.getTime()).toBe(invited!.createdAt.getTime());
    expect(after?.status).toBe("notified");
    expect(after?.inviteToken).toBe(invited!.inviteToken);
    expect(after?.invitedStartsAt).toEqual(invited!.invitedStartsAt);
  });

  it("does not let an edit jump the queue ahead of someone who waited longer", async () => {
    // The FIFO guarantee, observed through the thing that actually decides an
    // offer rather than through `created_at` directly.
    const { business, service, staffId } = await shop(60);

    await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 3_600_000),
    });
    await join(business.id, {
      phone: "0500000002",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    // The newer of the two edits their entry, which is the moment a naive
    // implementation would stamp a fresh `created_at`.
    await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: "השני",
      clientPhone: "0500000002",
      serviceId: null,
      preferredStaffId: null,
      preferredDays: [],
      preferredTimeWindow: "any",
      notes: "עודכן",
    });

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot: slotIn(120, staffId, service.id),
      now: NOW,
      dispatchNow: false,
    });

    // Still the one who has waited an hour, not the one who just typed.
    expect(offeredTo).toBe("לקוח 01");

    const live = await listWaitlistEntries(db, business.id);
    expect(live.map((r) => r.entry.clientPhone)).toEqual([
      "0500000001",
      "0500000002",
    ]);
  });
});

describe("the slot changing hands underneath an offer", () => {
  it("refuses to offer a slot the owner has already filled", async () => {
    /**
     * The owner takes a phone booking for the freed time before the queue is
     * reached. Offering it anyway would invite somebody to a booking the
     * exclusion constraint refuses on arrival — the worst message the product
     * could send, because it is an apology for something that never had to
     * happen.
     */
    const { business, service, staffId } = await shop(60);
    await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    const slot = slotIn(120, staffId, service.id);
    await createAppointment(
      db,
      business.id,
      service.id,
      slot.startsAt,
      slot.endsAt,
      { staffId, status: "confirmed" },
    );

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot,
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBeNull();
  });

  it("still offers when the clash is another provider's booking", async () => {
    /**
     * The constraint keys on `(business_id, staff_id)`, so a second chair
     * booked at the same time is not a clash at all. A check that looked only
     * at the time would refuse every offer in a team shop.
     */
    const { business, service, staffId } = await shop(60);

    await join(business.id, {
      phone: "0500000001",
      createdAt: new Date(NOW.getTime() - 600_000),
    });

    const second = await createStaff(db, business.id, { name: "כיסא שני" });
    expect(second.id).not.toBe(staffId);

    const slot = slotIn(120, staffId, service.id);
    await createAppointment(
      db,
      business.id,
      service.id,
      slot.startsAt,
      slot.endsAt,
      { staffId: second.id, status: "confirmed" },
    );

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot,
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBeTruthy();
  });
});
