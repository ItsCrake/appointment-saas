import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getWaitlistEntry, upsertWaitlistEntry } from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import type { Database } from "@/db/types";
import {
  BOOKINGS_PAUSED_CODE,
  BOOKINGS_PAUSED_MESSAGE,
} from "@/lib/bookings-pause";
import { offerSlotToWaitlist } from "@/lib/waitlist-offer";
import { createBusiness, createService } from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * Pausing online bookings (0035): what stops, what does not, and where.
 *
 * ---------------------------------------------------------------------------
 * **Two kinds of check, because the paths are two kinds of code.** The waitlist
 * offer is a plain function, so it runs here against a real schema with the
 * migration applied. The booking actions cannot: they reach for `headers()`,
 * which throws outside a request, which is why `dashboard-session.coverage`
 * reads action source rather than calling it. The property checked there is
 * the one a reviewer scans for — *does the refusal come before the write* — and
 * that is what is checked here too.
 *
 * **The other half is as load-bearing as the first.** A pause that also stopped
 * the owner's manual booking, their edit and move, or ליבי, would lock the
 * owner out of the calendar they paused the page to rearrange. So the owner's
 * paths are asserted *not* to read the flag at all.
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

async function shopWithQueue(bookingsPaused: boolean) {
  const business = await createBusiness(db, { bookingsPaused });
  const service = await createService(db, business.id, { durationMin: 60 });
  const [member] = await listActiveStaff(db, business.id);
  const { row } = await upsertWaitlistEntry(db, {
    businessId: business.id,
    clientName: "דני",
    clientPhone: "0500000001",
    serviceId: null,
    preferredStaffId: null,
    preferredDays: [],
    preferredTimeWindow: "any",
    notes: null,
  });

  const slot = {
    startsAt: new Date(NOW.getTime() + 3 * 3_600_000),
    endsAt: new Date(NOW.getTime() + 4 * 3_600_000),
    staffId: member.id,
    serviceId: service.id,
  };

  return { business, entryId: row.id, slot };
}

describe("the waitlist while bookings are paused", () => {
  it("offers a freed slot to nobody, and leaves the queue as it was", async () => {
    const { business, entryId, slot } = await shopWithQueue(true);

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot,
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBeNull();
    const entry = await getWaitlistEntry(db, business.id, entryId);
    expect(entry?.status).toBe("active");
    expect(entry?.inviteToken).toBeNull();
  });

  it("offers the same slot to the same person once the shop resumes", async () => {
    // The control: nothing about the queue or the slot is what refused above.
    const { business, entryId, slot } = await shopWithQueue(false);

    const { offeredTo } = await offerSlotToWaitlist({
      db,
      business,
      slot,
      now: NOW,
      dispatchNow: false,
    });

    expect(offeredTo).toBe("דני");
    const entry = await getWaitlistEntry(db, business.id, entryId);
    expect(entry?.status).toBe("notified");
  });

  it("defaults every shop to taking bookings", async () => {
    // The migration adds the column false and backfills nothing.
    const business = await createBusiness(db);
    expect(business.bookingsPaused).toBe(false);
  });
});

const source = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");

/** One exported function's text, up to the next top-level export. */
function body(text: string, name: string): string {
  const start = text.search(new RegExp(`export async function ${name}\\b`));
  if (start === -1) throw new Error(`${name} not found`);
  const next = text.slice(start + 1).search(/\nexport /);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/** Asserts `guard` appears in `fn` and comes before every one of `afters`. */
function refusesBefore(fn: string, guard: string, afters: string[]) {
  const at = fn.indexOf(guard);
  expect(at, `no ${guard}`).toBeGreaterThan(-1);
  for (const after of afters) {
    const later = fn.indexOf(after);
    expect(later, `no ${after}`).toBeGreaterThan(-1);
    expect(at, `${guard} must come before ${after}`).toBeLessThan(later);
  }
}

describe("every public way to book refuses first", () => {
  const booking = source("src/app/[slug]/actions.ts");

  it("refuses the slot lookup before computing availability", () => {
    const fn = body(booking, "fetchSlotsAction");
    refusesBefore(fn, "business.bookingsPaused", [
      "getAvailableSlotsWithStaff(",
    ]);
    expect(fn).toContain("code: BOOKINGS_PAUSED_CODE");
  });

  it("refuses the booking before availability and before the write", () => {
    const fn = body(booking, "createBookingAction");
    refusesBefore(fn, "businessRow.bookingsPaused", [
      "getAvailableSlotsWithStaff(",
      "createAppointment(",
    ]);
    expect(fn).toContain("code: BOOKINGS_PAUSED_CODE");
  });

  it("refuses the waitlist claim before the write, and keeps the person's place", () => {
    const fn = body(
      source("src/app/w/[token]/actions.ts"),
      "claimWaitlistSlotAction",
    );
    refusesBefore(fn, "business.bookingsPaused", ["createAppointment("]);
    // The guard's own body: from the check to the refusal it returns.
    const guard = fn.slice(fn.indexOf("business.bookingsPaused"));
    expect(guard.slice(0, guard.indexOf("return"))).toContain(
      'setWaitlistStatus(db, entry.id, "active", { clearInvite: true })',
    );
  });

  it("stops the automatic offer before anybody is invited", () => {
    const fn = body(source("src/lib/waitlist-offer.ts"), "offerSlotToWaitlist");
    refusesBefore(fn, "business.bookingsPaused", ["markWaitlistInvited("]);
  });

  it("tells the page it is a pause, in a sentence the page can show", () => {
    expect(BOOKINGS_PAUSED_CODE).toBe("BOOKINGS_PAUSED");
    // Plain Hebrew and no exclamation mark: the voice rule for transactional
    // copy, which a refusal is.
    expect(BOOKINGS_PAUSED_MESSAGE).toMatch(/[֐-׿]/);
    expect(BOOKINGS_PAUSED_MESSAGE).not.toContain("!");
    const flow = source("src/components/booking/booking-flow.tsx");
    expect(
      flow.split("BOOKINGS_PAUSED_CODE").length - 1,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("the owner's own writes ignore the pause", () => {
  it("never reads it in the dashboard's booking actions", () => {
    const dashboard = source("src/app/dashboard/actions.ts");
    for (const name of [
      "createManualBookingAction",
      "rescheduleAppointmentAction",
      "updateAppointmentDetailsAction",
      "setAppointmentStatusAction",
    ]) {
      expect(body(dashboard, name), name).not.toContain("bookingsPaused");
    }
  });

  it("never reads it where ליבי books", () => {
    expect(source("src/lib/voice/libi-tools.ts")).not.toContain(
      "bookingsPaused",
    );
  });
});

describe("the column ships with its migration", () => {
  it("is registered in the journal, after everything already applied", () => {
    const journal = JSON.parse(
      source("src/db/migrations/meta/_journal.json"),
    ) as {
      entries: { tag: string; when: number }[];
    };
    const entry = journal.entries.find((e) => e.tag === "0035_bookings_paused");
    expect(entry).toBeDefined();
    // Drizzle applies only what is newer than the last applied migration.
    const previous = journal.entries.find(
      (e) => e.tag === "0034_appointment_created_via",
    );
    expect(entry!.when).toBeGreaterThan(previous!.when);
  });

  it("adds the column false and not null", () => {
    const sql = source("src/db/migrations/0035_bookings_paused.sql");
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS "bookings_paused" boolean NOT NULL DEFAULT false/,
    );
    expect(source("src/db/schema.ts")).toContain(
      'bookingsPaused: boolean("bookings_paused").notNull().default(false)',
    );
  });
});
