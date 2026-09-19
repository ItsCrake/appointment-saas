import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  rescheduleAppointment,
  SlotTakenError,
  swapAppointments,
} from "@/db/queries/appointments";
import { appointments } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

import {
  BACK_TO_BACK_GAP_MIN,
  confirmSwap,
  planSwap,
  planSwapFor,
  type SwapSide,
} from "./appointment-swap";
import { planCalendarSwap } from "./calendar-edit";
import { loadCalendarWeek } from "./calendar-week-data";

/**
 * Two appointments trading places.
 *
 * ---------------------------------------------------------------------------
 * Three properties, each of which the obvious implementation gets wrong:
 *
 * 1. **The length stays with the appointment.** A 60-minute colour moved into
 *    a 30-minute cut's slot still needs an hour, so "swap" has to mean
 *    something more careful than exchanging start times.
 * 2. **Back to back, they swap order inside their block** — nothing overlaps a
 *    third booking and no hole opens in the day.
 * 3. **The write is one transaction, and the constraint still watches it.**
 *    Two sequential moves fail halfway whenever the two share a provider, and
 *    anything that does fail must leave both exactly where they were.
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

/** 10:00 local on a Friday in September, as UTC (IDT is +03). */
const day = (time: string) => new Date(`2026-09-04T${time}:00+03:00`);

const side = (
  id: string,
  from: string,
  minutes: number,
  staffId = "chair",
): SwapSide => ({
  id,
  staffId,
  startsAt: day(from),
  endsAt: new Date(day(from).getTime() + minutes * 60_000),
});

const hhmm = (at: Date) =>
  at.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
  });

describe("planSwap", () => {
  it("exchanges start times when the two are apart", () => {
    const plan = planSwap(side("a", "10:00", 30), side("b", "14:00", 30), {
      between: true,
    });
    expect(hhmm(plan.first.startsAt)).toBe("14:00");
    expect(hhmm(plan.second.startsAt)).toBe("10:00");
    expect(plan.repacked).toBe(false);
  });

  it("keeps each appointment's own length", () => {
    const plan = planSwap(side("a", "10:00", 60), side("b", "14:00", 30), {
      between: true,
    });
    expect(hhmm(plan.first.endsAt)).toBe("15:00");
    expect(hhmm(plan.second.endsAt)).toBe("10:30");
  });

  it("swaps order inside the block when they are back to back", () => {
    // 10:00–11:00 and 11:00–11:30 become 10:00–10:30 and 10:30–11:30: the
    // same block, full, with the order reversed.
    const plan = planSwap(side("a", "10:00", 60), side("b", "11:00", 30), {
      between: false,
    });
    expect(hhmm(plan.second.startsAt)).toBe("10:00");
    expect(hhmm(plan.second.endsAt)).toBe("10:30");
    expect(hhmm(plan.first.startsAt)).toBe("10:30");
    expect(hhmm(plan.first.endsAt)).toBe("11:30");
    expect(plan.repacked).toBe(true);
  });

  it("maps the plan back to the order the names were said in", () => {
    // Named later-first: the legs still belong to the right appointments.
    const plan = planSwap(side("b", "11:00", 30), side("a", "10:00", 60), {
      between: false,
    });
    expect(plan.first.id).toBe("b");
    expect(hhmm(plan.first.startsAt)).toBe("10:00");
    expect(plan.second.id).toBe("a");
    expect(hhmm(plan.second.startsAt)).toBe("10:30");
  });

  it("keeps a buffer between them where it was, in the middle", () => {
    const plan = planSwap(side("a", "10:00", 45), side("b", "10:55", 30), {
      between: false,
    });
    expect(hhmm(plan.second.startsAt)).toBe("10:00");
    expect(hhmm(plan.first.startsAt)).toBe("10:40");
    expect(hhmm(plan.first.endsAt)).toBe("11:25");
  });

  it("calls a gap longer than a buffer a break, and exchanges instead", () => {
    const late = `11:${String(BACK_TO_BACK_GAP_MIN + 5).padStart(2, "0")}`;
    const plan = planSwap(side("a", "10:00", 60), side("b", late, 30), {
      between: false,
    });
    expect(plan.repacked).toBe(false);
    expect(hhmm(plan.first.startsAt)).toBe(late);
  });

  it("is an exchange whenever somebody else sits between them", () => {
    const plan = planSwap(side("a", "10:00", 60), side("b", "11:00", 30), {
      between: true,
    });
    expect(plan.repacked).toBe(false);
    expect(hhmm(plan.first.startsAt)).toBe("11:00");
  });

  it("moves the provider with the slot", () => {
    const plan = planSwap(
      side("a", "10:00", 30, "shiran"),
      side("b", "10:00", 30, "maya"),
      { between: false },
    );
    expect(plan.first.staffId).toBe("maya");
    expect(plan.second.staffId).toBe("shiran");
  });
});

async function shop() {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 30 });
  const put = (from: string, minutes: number, clientName: string, staffId?: string) =>
    createAppointment(
      db,
      business.id,
      service.id,
      day(from),
      new Date(day(from).getTime() + minutes * 60_000),
      { clientName, ...(staffId ? { staffId } : {}) },
    );
  return { business, service, put };
}

async function startOf(id: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id));
  return { from: hhmm(row.startsAt), to: hhmm(row.endsAt) };
}

describe("swapAppointments", () => {
  it("swaps two back-to-back bookings that two single moves could not", async () => {
    const s = await shop();
    const colour = await s.put("10:00", 60, "דנה");
    const cut = await s.put("11:00", 30, "רונית");

    // The obvious way: move one, then the other. The first move lands on the
    // booking that has not moved yet, and the constraint refuses it.
    await expect(
      rescheduleAppointment(db, s.business.id, cut.id, {
        startsAt: day("10:00"),
        endsAt: day("10:30"),
      }),
    ).rejects.toBeInstanceOf(SlotTakenError);

    const plan = planSwap(colour, cut, { between: false });
    const rows = await swapAppointments(db, s.business.id, [
      { ...plan.first, fromStartsAt: colour.startsAt },
      { ...plan.second, fromStartsAt: cut.startsAt },
    ]);

    expect(rows?.map((row) => row.id)).toEqual([colour.id, cut.id]);
    expect(await startOf(cut.id)).toEqual({ from: "10:00", to: "10:30" });
    expect(await startOf(colour.id)).toEqual({ from: "10:30", to: "11:30" });
  });

  it("refuses the whole swap when either one moved since it was planned", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("14:00", 30, "רונית");
    const plan = planSwap(a, b, { between: true });

    await rescheduleAppointment(db, s.business.id, b.id, {
      startsAt: day("16:00"),
      endsAt: day("16:30"),
    });

    const rows = await swapAppointments(db, s.business.id, [
      { ...plan.first, fromStartsAt: a.startsAt },
      { ...plan.second, fromStartsAt: b.startsAt },
    ]);

    expect(rows).toBeNull();
    // Rolled back: the parked one is whole again.
    expect(await startOf(a.id)).toEqual({ from: "10:00", to: "10:30" });
  });

  it("rolls everything back when a third booking is in the way", async () => {
    const s = await shop();
    const a = await s.put("10:00", 60, "דנה");
    const b = await s.put("14:00", 30, "רונית");
    await s.put("14:30", 30, "עומר");
    const plan = planSwap(a, b, { between: true });

    await expect(
      swapAppointments(db, s.business.id, [
        { ...plan.first, fromStartsAt: a.startsAt },
        { ...plan.second, fromStartsAt: b.startsAt },
      ]),
    ).rejects.toBeInstanceOf(SlotTakenError);

    expect(await startOf(a.id)).toEqual({ from: "10:00", to: "11:00" });
    expect(await startOf(b.id)).toEqual({ from: "14:00", to: "14:30" });
  });

  it("does not reach another tenant's bookings", async () => {
    const mine = await shop();
    const theirs = await shop();
    const a = await theirs.put("10:00", 30, "א");
    const b = await theirs.put("14:00", 30, "ב");
    const plan = planSwap(a, b, { between: true });

    const rows = await swapAppointments(db, mine.business.id, [
      { ...plan.first, fromStartsAt: a.startsAt },
      { ...plan.second, fromStartsAt: b.startsAt },
    ]);
    expect(rows).toBeNull();
    expect(await startOf(a.id)).toEqual({ from: "10:00", to: "10:30" });
  });
});

describe("planSwapFor", () => {
  it("names the booking a longer appointment would run into", async () => {
    const s = await shop();
    const a = await s.put("10:00", 60, "דנה");
    const b = await s.put("14:00", 30, "רונית");
    await s.put("14:30", 30, "עומר");

    const result = await planSwapFor(db, s.business.id, a, b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.clash).toMatchObject({
        leg: "first",
        needsMinutes: 60,
        clientName: "עומר",
      });
      expect(hhmm(result.clash.startsAt)).toBe("14:30");
    }
  });

  it("treats a booking between them as a reason not to swap order", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    await s.put("10:30", 30, "באמצע");
    const b = await s.put("11:00", 30, "רונית");

    const result = await planSwapFor(db, s.business.id, a, b);
    expect(result.ok && result.plan.repacked).toBe(false);
    if (result.ok) expect(hhmm(result.plan.first.startsAt)).toBe("11:00");
  });

  it("catches the two running into each other with nobody else involved", async () => {
    // 30 minutes apart by more than a buffer, so they exchange start times —
    // and the hour-long one, now first, runs into the other's new place.
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("10:50", 60, "רונית");

    const result = await planSwapFor(db, s.business.id, a, b);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.clash).toMatchObject({ leg: "second", clientName: "דנה" });
    }
  });

  it("lets two providers exchange a shared hour", async () => {
    const s = await shop();
    const maya = await createStaff(db, s.business.id, { name: "מאיה" });
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("10:00", 30, "רונית", maya.id);

    const result = await planSwapFor(db, s.business.id, a, b);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.first.staffId).toBe(maya.id);
  });
});

describe("confirmSwap", () => {
  const request = (
    a: { id: string; startsAt: Date },
    b: { id: string; startsAt: Date },
    toA: Date,
    toB: Date,
  ) => ({
    first: {
      appointmentId: a.id,
      startsAtIso: a.startsAt.toISOString(),
      targetStartsAtIso: toA.toISOString(),
    },
    second: {
      appointmentId: b.id,
      startsAtIso: b.startsAt.toISOString(),
      targetStartsAtIso: toB.toISOString(),
    },
  });

  it("applies the swap it was asked about", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("14:00", 30, "רונית");

    const result = await confirmSwap(
      db,
      s.business.id,
      request(a, b, day("14:00"), day("10:00")),
    );
    expect(result.ok).toBe(true);
    expect(await startOf(a.id)).toEqual({ from: "14:00", to: "14:30" });
  });

  it("refuses when the plan made now is not the one that was described", async () => {
    /**
     * Back to back with a buffer, she described swapping their order. A
     * booking landing between them in the meantime turns the plan into an
     * exchange of start times — a different swap, which the "כן" was not for.
     */
    const s = await shop();
    const a = await s.put("10:00", 60, "דנה");
    const b = await s.put("11:10", 30, "רונית");
    const described = request(a, b, day("10:40"), day("10:00"));

    await s.put("11:00", 10, "נכנס באמצע");

    const result = await confirmSwap(db, s.business.id, described);
    expect(result).toEqual({ ok: false, reason: "stale" });
    expect(await startOf(a.id)).toEqual({ from: "10:00", to: "11:00" });
  });

  it("refuses the same booking twice", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const result = await confirmSwap(
      db,
      s.business.id,
      request(a, a, day("10:00"), day("10:00")),
    );
    expect(result).toEqual({ ok: false, reason: "stale" });
  });
});

describe("the calendar's swap, planned in the browser", () => {
  /**
   * The full calendar plans a swap from the week on screen, instantly, and
   * sends that plan's request to `confirmSwap` when the owner taps. The two
   * planners must never disagree — a plan the server re-makes differently is
   * refused as stale — so each case here builds the week with the page's own
   * loader, plans it as the browser does, and hands the result to the server.
   */
  const TZ = "Asia/Jerusalem";

  async function weekOf(s: Awaited<ReturnType<typeof shop>>) {
    const week = await loadCalendarWeek(
      db,
      { id: s.business.id, timezone: TZ },
      "2026-09-04",
      "2026-09-01",
    );
    return week.entries;
  }

  it("plans an exchange the server then applies exactly", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("14:00", 30, "רונית");

    const plan = planCalendarSwap(await weekOf(s), a.id, b.id, TZ);
    if (!plan?.ok) throw new Error("expected a plan");
    expect(plan.legs.map((leg) => leg.time)).toEqual(["14:00", "10:00"]);

    const confirmed = await confirmSwap(db, s.business.id, plan.request);
    expect(confirmed.ok).toBe(true);
    expect(await startOf(a.id)).toEqual({ from: "14:00", to: "14:30" });
    expect(await startOf(b.id)).toEqual({ from: "10:00", to: "10:30" });
  });

  it("plans a back-to-back pair of two lengths as the server's reorder", async () => {
    const s = await shop();
    const colour = await s.put("10:00", 60, "דנה");
    const cut = await s.put("11:00", 30, "רונית");

    const plan = planCalendarSwap(await weekOf(s), colour.id, cut.id, TZ);
    if (!plan?.ok) throw new Error("expected a plan");
    expect(plan.repacked).toBe(true);
    expect(plan.legs.map((leg) => leg.time)).toEqual(["10:30", "10:00"]);

    const confirmed = await confirmSwap(db, s.business.id, plan.request);
    expect(confirmed.ok).toBe(true);
    expect(await startOf(cut.id)).toEqual({ from: "10:00", to: "10:30" });
    expect(await startOf(colour.id)).toEqual({ from: "10:30", to: "11:30" });
  });

  it("sees a booking between them, as the server does, and exchanges instead", async () => {
    const s = await shop();
    const a = await s.put("10:00", 60, "דנה");
    const b = await s.put("11:10", 30, "רונית");
    await s.put("11:00", 10, "נכנס באמצע");

    const plan = planCalendarSwap(await weekOf(s), a.id, b.id, TZ);
    const [rowA] = await db.select().from(appointments).where(eq(appointments.id, a.id));
    const [rowB] = await db.select().from(appointments).where(eq(appointments.id, b.id));
    const server = await planSwapFor(db, s.business.id, rowA, rowB);
    if (!plan?.ok || !server.ok) throw new Error("expected both to plan");

    // Not back to back any more, so no reorder: each takes the other's start,
    // exactly where the server's own planner puts them.
    expect(plan.repacked).toBe(false);
    expect(plan.request.first.targetStartsAtIso).toBe(
      server.plan.first.startsAt.toISOString(),
    );
    expect(plan.request.second.targetStartsAtIso).toBe(
      server.plan.second.startsAt.toISOString(),
    );
    expect((await confirmSwap(db, s.business.id, plan.request)).ok).toBe(true);
    expect(await startOf(a.id)).toEqual({ from: "11:10", to: "12:10" });
  });

  it("names the booking a longer leg would run into, and writes nothing", async () => {
    const s = await shop();
    const colour = await s.put("10:00", 60, "דנה");
    const cut = await s.put("14:00", 30, "רונית");
    await s.put("14:30", 30, "יוסי");

    const plan = planCalendarSwap(await weekOf(s), colour.id, cut.id, TZ);
    expect(plan).toMatchObject({
      ok: false,
      clash: { leg: "first", who: "דנה", needsMinutes: 60, clientName: "יוסי", time: "14:30" },
    });
    expect(await startOf(colour.id)).toEqual({ from: "10:00", to: "11:00" });
  });

  it("moves the provider with the slot, and the server agrees", async () => {
    const s = await shop();
    const second = await createStaff(db, s.business.id, { name: "מאיה" });
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("10:00", 30, "רונית", second.id);

    const plan = planCalendarSwap(await weekOf(s), a.id, b.id, TZ);
    if (!plan?.ok) throw new Error("expected a plan");
    expect(plan.legs[0].staffId).toBe(second.id);
    expect(plan.legs[1].staffId).toBe(a.staffId);

    const confirmed = await confirmSwap(db, s.business.id, plan.request);
    expect(confirmed.ok).toBe(true);
  });

  it("is refused as stale when the week moved underneath it", async () => {
    const s = await shop();
    const a = await s.put("10:00", 30, "דנה");
    const b = await s.put("14:00", 30, "רונית");
    const plan = planCalendarSwap(await weekOf(s), a.id, b.id, TZ);
    if (!plan?.ok) throw new Error("expected a plan");

    // Somebody else moved one of them after the tray was drawn.
    await rescheduleAppointment(db, s.business.id, b.id, {
      startsAt: day("15:00"),
      endsAt: day("15:30"),
    });
    expect(await confirmSwap(db, s.business.id, plan.request)).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
