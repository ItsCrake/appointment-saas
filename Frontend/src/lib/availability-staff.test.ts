import { describe, expect, it } from "vitest";

import {
  computeStaffSlots,
  intersectShifts,
  staffAvailableAt,
  type AvailabilityBusiness,
  type AvailabilityShift,
} from "@/lib/availability";

const business: AvailabilityBusiness = {
  timezone: "Asia/Jerusalem",
  slotIntervalMin: 15,
  bufferMin: 0,
  minNoticeMin: 0,
  maxAdvanceDays: 60,
};

const DATE = "2026-09-07";
/** Well before the day, so `minNoticeMin` never trims the front of it. */
const NOW = new Date("2026-09-01T00:00:00Z");

const shift = (startTime: string, endTime: string): AvailabilityShift => ({
  startTime,
  endTime,
  isClosed: false,
});

const NINE_TO_TWELVE = [shift("09:00", "12:00")];

/** Local wall-clock on DATE, as the UTC instant the engine returns. */
const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`).toISOString();

const busy = (from: string, to: string) => ({
  startsAt: new Date(`${DATE}T${from}:00+03:00`),
  endsAt: new Date(`${DATE}T${to}:00+03:00`),
});

function run(
  staff: {
    id: string;
    shifts?: AvailabilityShift[];
    appointments?: { startsAt: Date; endsAt: Date }[];
    timeOff?: { startsAt: Date; endsAt: Date }[];
  }[],
  overrides: Partial<{
    durationMin: number;
    businessShifts: AvailabilityShift[];
    businessTimeOff: { startsAt: Date; endsAt: Date }[];
    serviceBufferMin: number | null;
  }> = {},
) {
  return computeStaffSlots({
    business,
    durationMin: overrides.durationMin ?? 60,
    serviceBufferMin: overrides.serviceBufferMin ?? null,
    businessShifts: overrides.businessShifts ?? NINE_TO_TWELVE,
    businessTimeOff: overrides.businessTimeOff ?? [],
    staff: staff.map((member) => ({
      id: member.id,
      shifts: member.shifts ?? [],
      appointments: member.appointments ?? [],
      timeOff: member.timeOff ?? [],
    })),
    date: DATE,
    now: NOW,
  });
}

describe("computeStaffSlots — the property the whole feature rests on", () => {
  it("keeps a time open for one provider when another is booked at it", () => {
    // The headline requirement: an appointment for Staff A must not remove the
    // time from Staff B. It falls out of running the engine per person, because
    // each run only ever sees that person's own busy list.
    const slots = run([
      { id: "a", appointments: [busy("09:00", "10:00")] },
      { id: "b" },
    ]);

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual(["b"]);
    // Later times are still open to both.
    expect(staffAvailableAt(slots, at("10:00")).sort()).toEqual(["a", "b"]);
  });

  it("drops a time only when every provider is busy at it", () => {
    const slots = run([
      { id: "a", appointments: [busy("09:00", "10:00")] },
      { id: "b", appointments: [busy("09:00", "10:00")] },
    ]);

    expect(slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([]);
  });

  it("returns the union of differing schedules, not the intersection", () => {
    // A morning person and an afternoon person between them cover the whole
    // day, and the client should be offered all of it.
    const slots = run(
      [
        { id: "early", shifts: [shift("09:00", "11:00")] },
        { id: "late", shifts: [shift("11:00", "13:00")] },
      ],
      { businessShifts: [shift("09:00", "13:00")] },
    );

    expect(slots.map((s) => s.label)).toEqual([
      "09:00",
      "10:00",
      "11:00",
      "12:00",
    ]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual(["early"]);
    expect(staffAvailableAt(slots, at("12:00"))).toEqual(["late"]);
  });

  it("inherits the business hours for a provider with no schedule rows", () => {
    // The absence of rows is meaningful, and is what keeps the feature free for
    // a shop that does not need it.
    const withRows = run([{ id: "a", shifts: [shift("09:00", "10:00")] }]);
    const withoutRows = run([{ id: "a" }]);

    expect(withRows.map((s) => s.label)).toEqual(["09:00"]);
    expect(withoutRows.map((s) => s.label)).toEqual([
      "09:00",
      "10:00",
      "11:00",
    ]);
  });

  it("applies business time off to everyone", () => {
    // A closure of the shop — a holiday, a renovation — removes the time from
    // the page entirely.
    const slots = run([{ id: "a" }, { id: "b" }], {
      businessTimeOff: [busy("10:00", "11:00")],
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "11:00"]);
    expect(staffAvailableAt(slots, at("10:00"))).toEqual([]);
  });
});

describe("computeStaffSlots — per-staff time off (0016)", () => {
  it("removes one name from the picker without removing the time", () => {
    // The distinction the whole migration exists for: one barber's afternoon
    // off is not the shop closing.
    const slots = run([
      { id: "a", timeOff: [busy("10:00", "11:00")] },
      { id: "b" },
    ]);

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
    expect(staffAvailableAt(slots, at("10:00"))).toEqual(["b"]);
    // Either side of it, both are still offered.
    expect(staffAvailableAt(slots, at("09:00")).sort()).toEqual(["a", "b"]);
    expect(staffAvailableAt(slots, at("11:00")).sort()).toEqual(["a", "b"]);
  });

  it("drops the time only when every provider is away at it", () => {
    const slots = run([
      { id: "a", timeOff: [busy("10:00", "11:00")] },
      { id: "b", timeOff: [busy("10:00", "11:00")] },
    ]);

    expect(slots.map((s) => s.label)).toEqual(["09:00", "11:00"]);
  });

  it("composes shop closures with personal absence rather than choosing", () => {
    // A shop closed for a holiday is closed for someone who also happens to be
    // on leave that week. `a` is away at 09:00 and the shop is shut at 11:00,
    // so only 10:00 survives — and only for `b` at 09:00.
    const slots = run(
      [{ id: "a", timeOff: [busy("09:00", "10:00")] }, { id: "b" }],
      { businessTimeOff: [busy("11:00", "12:00")] },
    );

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00"]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual(["b"]);
    expect(staffAvailableAt(slots, at("10:00")).sort()).toEqual(["a", "b"]);
    expect(staffAvailableAt(slots, at("11:00"))).toEqual([]);
  });

  it("applies no buffer around an absence, matching shop closures", () => {
    // Time off blocks on plain overlap. A 30-minute service either side of a
    // one-hour absence is bookable right up against it.
    const slots = run([{ id: "a", timeOff: [busy("10:00", "10:30")] }], {
      durationMin: 30,
      businessShifts: [shift("09:00", "11:00")],
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "09:30", "10:30"]);
  });

  it("re-anchors the grid after an absence, like any other closure", () => {
    // The cursor jumps to the end of the closure rather than resuming on the
    // original line, so no unbookable sliver is left behind.
    const slots = run([{ id: "a", timeOff: [busy("09:10", "09:40")] }], {
      durationMin: 30,
      businessShifts: [shift("09:00", "11:00")],
    });

    // 10:40 would end at 11:10, past the shift, so the walk stops at 10:10.
    expect(slots.map((s) => s.label)).toEqual(["09:40", "10:10"]);
  });

  it("lists staff in the order they were supplied, which is the display order", () => {
    // `listActiveStaff` sorts by sortOrder → createdAt → id, and the picker
    // renders `staffIds` directly. An unstable order would move a default pick
    // between providers on a refresh.
    const slots = run([{ id: "first" }, { id: "second" }, { id: "third" }]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("is identical to the single-resource engine for a one-person shop", () => {
    // The migration path: a tenant that never answers the multi-staff question
    // must see exactly what it saw before.
    const slots = run([{ id: "solo", appointments: [busy("10:00", "11:00")] }]);

    expect(slots.map((s) => s.label)).toEqual(["09:00", "11:00"]);
    expect(slots.every((s) => s.staffIds.length === 1)).toBe(true);
  });

  it("re-anchors per provider rather than across the team", () => {
    // The cursor walk moves the grid after a booking. That must happen inside
    // one person's day: A's 09:20 appointment must not shift B's grid, or the
    // team would drift out of alignment for no reason.
    const slots = run(
      [{ id: "a", appointments: [busy("09:20", "09:50")] }, { id: "b" }],
      { durationMin: 30, businessShifts: [shift("09:00", "11:00")] },
    );

    // B keeps the clean grid.
    expect(staffAvailableAt(slots, at("09:30"))).toEqual(["b"]);
    // A resumes from 09:50, which B does not offer.
    expect(staffAvailableAt(slots, at("09:50"))).toEqual(["a"]);
  });

  it("returns nothing when the team is empty", () => {
    expect(run([])).toEqual([]);
  });

  it("skips a provider whose day is closed without hiding the others", () => {
    const slots = run([
      { id: "off", shifts: [{ ...shift("09:00", "12:00"), isClosed: true }] },
      { id: "on" },
    ]);

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
    expect(staffAvailableAt(slots, at("09:00"))).toEqual(["on"]);
  });
});

/**
 * A personal schedule narrows when someone works. It never opens the shop.
 *
 * These are regression tests for a real production bug: staff shifts *replaced*
 * the business hours instead of intersecting with them, so a provider whose row
 * ran 08:00–20:00 was offered from 08:00 to 20:00 against a shop open
 * 09:00–17:00 — and since only that one person had a row, those off-hours times
 * showed exactly one provider free, which is how it was noticed.
 */
describe("computeStaffSlots — staff hours are clipped to the shop's", () => {
  it("does not open the shop early for a provider who starts before it", () => {
    const slots = run([{ id: "keen", shifts: [shift("06:00", "12:00")] }], {
      businessShifts: NINE_TO_TWELVE,
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("does not keep it open late for a provider who finishes after it", () => {
    const slots = run([{ id: "night", shifts: [shift("09:00", "20:00")] }], {
      businessShifts: NINE_TO_TWELVE,
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("clips both ends at once", () => {
    const slots = run([{ id: "long", shifts: [shift("06:00", "23:00")] }], {
      businessShifts: [shift("10:00", "12:00")],
    });

    expect(slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);
  });

  it("offers nothing on a weekday the shop has no hours for", () => {
    // The worst shape of the bug: a schedule row on a closed day produced a
    // fully bookable day out of nothing.
    expect(
      run([{ id: "a", shifts: [shift("09:00", "17:00")] }], {
        businessShifts: [],
      }),
    ).toEqual([]);
  });

  it("offers nothing when the shop's only row for the day is closed", () => {
    expect(
      run([{ id: "a", shifts: [shift("09:00", "17:00")] }], {
        businessShifts: [{ ...shift("09:00", "17:00"), isClosed: true }],
      }),
    ).toEqual([]);
  });

  it("offers nothing when the personal hours miss the shop's entirely", () => {
    expect(
      run([{ id: "a", shifts: [shift("18:00", "22:00")] }], {
        businessShifts: NINE_TO_TWELVE,
      }),
    ).toEqual([]);
  });

  it("does not fall back to the shop's hours on an empty intersection", () => {
    // The trap in the fix: an empty *result* must not be read as "no rows", or
    // the person who works no valid hours is handed the entire day.
    const slots = run([{ id: "a", shifts: [shift("18:00", "22:00")] }], {
      businessShifts: NINE_TO_TWELVE,
    });

    expect(staffAvailableAt(slots, at("09:00"))).toEqual([]);
  });

  it("splits a straight personal shift across a split business day", () => {
    // Shop open 09:00–11:00 and 14:00–16:00; the provider claims 09:00–16:00.
    // The lunch break belongs to the shop, so it survives.
    const slots = run([{ id: "a", shifts: [shift("09:00", "16:00")] }], {
      businessShifts: [shift("09:00", "11:00"), shift("14:00", "16:00")],
    });

    expect(slots.map((s) => s.label)).toEqual([
      "09:00",
      "10:00",
      "14:00",
      "15:00",
    ]);
  });

  it("clips one provider without touching another who has no rows", () => {
    const slots = run(
      [{ id: "early", shifts: [shift("06:00", "10:00")] }, { id: "normal" }],
      { businessShifts: NINE_TO_TWELVE },
    );

    // 08:00 was the bug; it must not appear for anyone.
    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
    expect(staffAvailableAt(slots, at("09:00")).sort()).toEqual([
      "early",
      "normal",
    ]);
    expect(staffAvailableAt(slots, at("11:00"))).toEqual(["normal"]);
  });

  it("applies to a one-person shop too, where nobody picks a provider", () => {
    // `hasMultipleStaff` never reaches *this* function — it is handed a list
    // and unions it. The flag decides who goes *into* the list, one level up in
    // `getAvailableSlotsWithStaff`. So a single-staff tenant runs the identical
    // algorithm, which is why the off-hours bug was never limited to teams.
    const slots = run([{ id: "solo", shifts: [shift("07:00", "22:00")] }], {
      businessShifts: NINE_TO_TWELVE,
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("compares wall-clock times numerically, not as strings", () => {
    // A `time` column returns "09:00:00" while a form sends "09:00". Compared
    // as text, "09:00" sorts before "09:00:00" and the shift loses its first
    // slot for no reason a reader could ever guess.
    const slots = run([{ id: "a", shifts: [shift("09:00", "12:00")] }], {
      businessShifts: [shift("09:00:00", "12:00:00")],
    });

    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });
});

describe("intersectShifts", () => {
  const clip = (from: string, to: string) => ({
    startTime: from,
    endTime: to,
    isClosed: false,
  });

  it("returns the overlap of a single pair", () => {
    expect(
      intersectShifts([shift("08:00", "18:00")], [shift("09:00", "17:00")]),
    ).toEqual([clip("09:00:00", "17:00:00")]);
  });

  it("treats a touching endpoint as no overlap", () => {
    // 09:00–12:00 against 12:00–17:00 shares no bookable minute.
    expect(
      intersectShifts([shift("09:00", "12:00")], [shift("12:00", "17:00")]),
    ).toEqual([]);
  });

  it("drops a shift the shop has marked closed", () => {
    expect(
      intersectShifts(
        [shift("09:00", "17:00")],
        [{ ...shift("09:00", "17:00"), isClosed: true }],
      ),
    ).toEqual([]);
  });

  it("drops an unparseable or inverted personal shift rather than widening it", () => {
    // The safe reading of a broken row is that it grants nothing. Falling back
    // to the shop's hours would turn a typo into extra availability.
    for (const broken of [
      shift("nonsense", "17:00"),
      shift("17:00", "09:00"),
      shift("25:00", "26:00"),
      shift("09:00", "09:00"),
    ]) {
      expect(intersectShifts([broken], [shift("09:00", "17:00")])).toEqual([]);
    }
  });

  it("keeps every piece when one shift spans several business windows", () => {
    expect(
      intersectShifts(
        [shift("08:00", "20:00")],
        [shift("09:00", "12:00"), shift("14:00", "17:00")],
      ),
    ).toEqual([clip("09:00:00", "12:00:00"), clip("14:00:00", "17:00:00")]);
  });
});

describe("staffAvailableAt", () => {
  it("answers empty for a time that was never offered", () => {
    // The booking action calls this to re-check a client's echoed choice, so a
    // fabricated start must resolve to nobody rather than to the first person.
    const slots = run([{ id: "a" }]);
    expect(staffAvailableAt(slots, at("23:00"))).toEqual([]);
    expect(staffAvailableAt(slots, "not-a-time")).toEqual([]);
  });
});
