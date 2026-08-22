import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getWaitlistEntry,
  markWaitlistInvited,
  upsertWaitlistEntry,
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";
import { runWaitlistOfferExpirySweep } from "@/lib/waitlist-expiry";

/**
 * The expiry sweep over the real query path (0025).
 *
 * `waitlist.test.ts` proves when an offer is past its deadline; this proves
 * what the database looks like afterwards — who lost their place, who got the
 * slot next, and the two cases where the slot is deliberately not passed on at
 * all.
 *
 * **Every clock in here is explicit.** `markWaitlistInvited` stamps `now()`, so
 * each test backdates `invited_at` and hands the sweep its own `now` rather
 * than arranging for real time to pass. That is what makes the boundary cases
 * assertions instead of races.
 */

const NOW = new Date("2027-03-02T09:00:00Z");
/** Three days out, so the slot itself is never the binding deadline. */
const SLOT_START = new Date("2027-03-05T09:00:00Z");
const SLOT_END = new Date("2027-03-05T10:00:00Z");

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

/**
 * Somebody in the queue with no preferences at all, so the match is never the
 * thing under test here. `created_at` is set explicitly because FIFO is the
 * ordering the re-offer depends on, and two inserts in the same millisecond
 * would make which of them is "next" a coin flip.
 */
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

/** Offers the slot to an entry, then rewrites when the offer was made. */
async function offerTo(
  entryId: string,
  { staffId, serviceId }: { staffId: string; serviceId: string },
  invitedAt: Date,
) {
  const invited = await markWaitlistInvited(db, entryId, {
    inviteToken: `tok-${entryId.slice(0, 8)}`,
    invitedStartsAt: SLOT_START,
    invitedEndsAt: SLOT_END,
    invitedStaffId: staffId,
    invitedServiceId: serviceId,
  });

  await harness.pg.query(
    `UPDATE waitlist_entries SET invited_at = $1 WHERE id = $2`,
    [invitedAt.toISOString(), entryId],
  );

  return invited;
}

const minutesBefore = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

describe("the offer window", () => {
  it("leaves an offer alone while it is still live", async () => {
    const { business, service, staffId } = await shop(60);
    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(10),
    );

    const summary = await runWaitlistOfferExpirySweep(db, { now: NOW });

    expect(summary).toEqual({ expired: 0, reoffered: 0 });
    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "notified",
    );
  });

  it("never expires an offer when the shop has switched the window off", async () => {
    // 0 is the opt-out, and it has to hold even for an offer made a week ago.
    const { business, service, staffId } = await shop(0);
    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(10_080),
    );

    expect(await runWaitlistOfferExpirySweep(db, { now: NOW })).toEqual({
      expired: 0,
      reoffered: 0,
    });
    expect((await getWaitlistEntry(db, business.id, first.id))?.status).toBe(
      "notified",
    );
  });
});

describe("cycling a lapsed offer", () => {
  it("expires the invited client and offers the slot to the next in line", async () => {
    const { business, service, staffId } = await shop(60);

    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });
    const second = await join(business.id, {
      phone: "0500000002",
      createdAt: minutesBefore(300),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(61),
    );

    const summary = await runWaitlistOfferExpirySweep(db, { now: NOW });

    expect(summary).toEqual({ expired: 1, reoffered: 1 });

    const lapsed = await getWaitlistEntry(db, business.id, first.id);
    const next = await getWaitlistEntry(db, business.id, second.id);

    expect(lapsed?.status).toBe("expired");
    expect(next?.status).toBe("notified");
    expect(next?.invitedStartsAt).toEqual(SLOT_START);
    expect(next?.invitedStaffId).toBe(staffId);
  });

  it("keeps the lapsed token, so the old link still explains itself", async () => {
    /**
     * Every other exit from the queue clears the token. This one must not: the
     * client is about to tap a link they were sent an hour ago, and with no
     * token `getWaitlistEntryByToken` returns nothing and `/w/[token]` renders
     * a 404 instead of the screen that tells them what happened. The token is
     * inert regardless — the claim action refuses an `expired` entry.
     */
    const { business, service, staffId } = await shop(60);
    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(61),
    );
    await runWaitlistOfferExpirySweep(db, { now: NOW });

    const lapsed = await getWaitlistEntry(db, business.id, first.id);
    expect(lapsed?.status).toBe("expired");
    expect(lapsed?.inviteToken).toBeTruthy();
  });

  it("does not hand the slot back to the person who just let it go", async () => {
    /**
     * The loop this feature could most easily have shipped with. `expired` is
     * terminal for matching, so the re-offer three lines later cannot see the
     * entry it just wrote — which is the whole reason the lapse is a status
     * change rather than a return to `active`.
     */
    const { business, service, staffId } = await shop(60);
    const alone = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });

    await offerTo(
      alone.id,
      { staffId, serviceId: service.id },
      minutesBefore(61),
    );

    const summary = await runWaitlistOfferExpirySweep(db, { now: NOW });

    expect(summary).toEqual({ expired: 1, reoffered: 0 });
    expect((await getWaitlistEntry(db, business.id, alone.id))?.status).toBe(
      "expired",
    );
  });

  it("does not re-offer a slot the owner filled while the invite sat unanswered", async () => {
    /**
     * The reason `offerSlotToWaitlist` re-checks the appointments table. An
     * hour passes between the offer and the sweep, and the owner taking a
     * phone booking in that hour is ordinary. Inviting somebody to a slot the
     * exclusion constraint will refuse on arrival is the worst message this
     * product could send.
     */
    const { business, service, staffId } = await shop(60);

    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });
    const second = await join(business.id, {
      phone: "0500000002",
      createdAt: minutesBefore(300),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(61),
    );

    await createAppointment(db, business.id, service.id, SLOT_START, SLOT_END, {
      staffId,
      status: "confirmed",
    });

    const summary = await runWaitlistOfferExpirySweep(db, { now: NOW });

    expect(summary).toEqual({ expired: 1, reoffered: 0 });
    expect((await getWaitlistEntry(db, business.id, second.id))?.status).toBe(
      "active",
    );
  });

  it("does not re-offer a slot that has since passed", async () => {
    // Swept late — the cron missed a run, or the offer was made for something
    // imminent. There is nothing to pass on.
    const { business, service, staffId } = await shop(60);

    const first = await join(business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });
    const second = await join(business.id, {
      phone: "0500000002",
      createdAt: minutesBefore(300),
    });

    await offerTo(
      first.id,
      { staffId, serviceId: service.id },
      minutesBefore(61),
    );

    const afterTheSlot = new Date(SLOT_START.getTime() + 3_600_000);
    const summary = await runWaitlistOfferExpirySweep(db, {
      now: afterTheSlot,
    });

    expect(summary).toEqual({ expired: 1, reoffered: 0 });
    expect((await getWaitlistEntry(db, business.id, second.id))?.status).toBe(
      "active",
    );
  });

  it("sweeps each tenant against its own window", async () => {
    /**
     * The setting is per-shop and the sweep is global, so the one query that
     * reads every live offer has to carry each shop's own number with it.
     * Reading one tenant's window and applying it to another is the shape of
     * bug a global sweep invites.
     */
    const patient = await shop(240);
    const brisk = await shop(30);

    const theirs = await join(patient.business.id, {
      phone: "0500000001",
      createdAt: minutesBefore(600),
    });
    const ours = await join(brisk.business.id, {
      phone: "0500000002",
      createdAt: minutesBefore(600),
    });

    // The same offer age for both: past 30 minutes, well inside 240.
    await offerTo(
      theirs.id,
      { staffId: patient.staffId, serviceId: patient.service.id },
      minutesBefore(45),
    );
    await offerTo(
      ours.id,
      { staffId: brisk.staffId, serviceId: brisk.service.id },
      minutesBefore(45),
    );

    const summary = await runWaitlistOfferExpirySweep(db, { now: NOW });

    expect(summary.expired).toBe(1);
    expect(
      (await getWaitlistEntry(db, patient.business.id, theirs.id))?.status,
    ).toBe("notified");
    expect(
      (await getWaitlistEntry(db, brisk.business.id, ours.id))?.status,
    ).toBe("expired");
  });
});
