import { describe, expect, it } from "vitest";

import {
  baseGridMinutes,
  computeSlots,
  freeWindows,
  mergeIntervals,
  subtractIntervals,
  weekdayOf,
  type AvailabilityBusiness,
  type BusyInterval,
  type SlotPacking,
} from "@/lib/availability";

/**
 * The interval model underneath the engine.
 *
 * `availability.test.ts` covers the rules a shop can describe — hours, notice,
 * DST. This file covers the thing those rules are computed *from*: contiguous
 * free windows, and how candidate starts are placed inside them. The bugs it
 * guards against are the ones that only appear on a messy day — a calendar with
 * gaps of different sizes scattered through it, which is what a real Tuesday
 * afternoon looks like and what no tidy fixture reproduces.
 */

const TZ = "Asia/Jerusalem";
const DATE = "2026-08-03";
const NOW = new Date("2026-07-01T00:00:00Z");

/** Local wall clock on DATE as the UTC instant the engine returns. IDT = +03. */
const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`);
const ms = (time: string) => at(time).getTime();

const business: AvailabilityBusiness = {
  timezone: TZ,
  slotIntervalMin: 15,
  bufferMin: 0,
  minNoticeMin: 0,
  maxAdvanceDays: 365,
};

const shift = (from: string, to: string) => ({
  startTime: from,
  endTime: to,
  isClosed: false,
});

const busy = (from: string, to: string): BusyInterval => ({
  startsAt: at(from),
  endsAt: at(to),
});

function labels(
  options: {
    durationMin?: number;
    serviceBufferMin?: number | null;
    appointments?: BusyInterval[];
    timeOff?: BusyInterval[];
    shifts?: ReturnType<typeof shift>[];
    packing?: SlotPacking;
    businessOverrides?: Partial<AvailabilityBusiness>;
  } = {},
) {
  return computeSlots({
    business: { ...business, ...options.businessOverrides },
    durationMin: options.durationMin ?? 60,
    serviceBufferMin: options.serviceBufferMin,
    shifts: options.shifts ?? [shift("09:00", "17:00")],
    appointments: options.appointments ?? [],
    timeOff: options.timeOff ?? [],
    date: DATE,
    now: NOW,
    packing: options.packing,
  }).map((s) => s.label);
}

/* -------------------------------------------------------------------------- */

describe("interval algebra", () => {
  it("merges overlapping intervals", () => {
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 15, end: 30 },
      ]),
    ).toEqual([{ start: 10, end: 30 }]);
  });

  it("merges intervals that only touch", () => {
    // Two bookings meeting exactly at 10:00 leave no free time between them.
    // Treating the seam as a window would offer a zero-length gap.
    expect(
      mergeIntervals([
        { start: 10, end: 20 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([{ start: 10, end: 30 }]);
  });

  it("keeps genuinely separate intervals apart", () => {
    expect(
      mergeIntervals([
        { start: 30, end: 40 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
  });

  it("subtracts a block from the middle, leaving two windows", () => {
    expect(
      subtractIntervals([{ start: 0, end: 100 }], [{ start: 40, end: 60 }]),
    ).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
  });

  it("drops a window swallowed whole", () => {
    expect(
      subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 100 }]),
    ).toEqual([]);
  });

  it("clips a block that hangs over both edges", () => {
    expect(
      subtractIntervals([{ start: 10, end: 90 }], [{ start: 0, end: 50 }]),
    ).toEqual([{ start: 50, end: 90 }]);
  });

  it("handles blocks arriving out of order", () => {
    expect(
      subtractIntervals(
        [{ start: 0, end: 100 }],
        [
          { start: 70, end: 80 },
          { start: 20, end: 30 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 70 },
      { start: 80, end: 100 },
    ]);
  });
});

describe("free windows", () => {
  const window = (from: string, to: string) => ({
    start: ms(from),
    end: ms(to),
  });

  it("is the whole shift when nothing is booked", () => {
    expect(
      freeWindows({
        shifts: [window("09:00", "17:00")],
        appointments: [],
        timeOff: [],
        bufferMs: 0,
      }),
    ).toEqual([window("09:00", "17:00")]);
  });

  it("splits around scattered mid-day bookings", () => {
    // The shape this whole model exists for: two appointments with an
    // unbooked hour between them that a cursor walking the day never had to
    // name, and therefore could never be asserted on.
    expect(
      freeWindows({
        shifts: [window("09:00", "17:00")],
        appointments: [window("10:00", "11:00"), window("12:00", "13:00")],
        timeOff: [],
        bufferMs: 0,
      }),
    ).toEqual([
      window("09:00", "10:00"),
      window("11:00", "12:00"),
      window("13:00", "17:00"),
    ]);
  });

  it("eats into the window from both sides of a booking's buffer", () => {
    // A 10-minute buffer around 12:00–13:00 blocks 11:50–13:10, so the window
    // before it ends at 11:50 and the one after starts at 13:10. The candidate
    // test can then be a plain "does it fit", with no buffer arithmetic left.
    expect(
      freeWindows({
        shifts: [window("09:00", "17:00")],
        appointments: [window("12:00", "13:00")],
        timeOff: [],
        bufferMs: 10 * 60_000,
      }),
    ).toEqual([window("09:00", "11:50"), window("13:10", "17:00")]);
  });

  it("applies no buffer to a closure", () => {
    expect(
      freeWindows({
        shifts: [window("09:00", "17:00")],
        appointments: [],
        timeOff: [window("12:00", "13:00")],
        bufferMs: 30 * 60_000,
      }),
    ).toEqual([window("09:00", "12:00"), window("13:00", "17:00")]);
  });

  it("keeps split shifts separate rather than bridging the break", () => {
    expect(
      freeWindows({
        shifts: [window("09:00", "12:00"), window("16:00", "19:00")],
        appointments: [],
        timeOff: [],
        bufferMs: 0,
      }),
    ).toEqual([window("09:00", "12:00"), window("16:00", "19:00")]);
  });
});

/* -------------------------------------------------------------------------- */

describe("single-staff gap packing", () => {
  it("offers the first slot at the window's own start, not the next round number", () => {
    // A 35-minute booking ends at 09:35 and the chair is free from that
    // instant. Waiting until 10:00 to offer anything throws away 25 minutes
    // for tidiness.
    expect(
      labels({ durationMin: 30, appointments: [busy("09:00", "09:35")] })[0],
    ).toBe("09:35");
  });

  it("packs a window back to back in whole blocks", () => {
    expect(
      labels({
        durationMin: 60,
        shifts: [shift("09:00", "13:00")],
      }),
    ).toEqual(["09:00", "10:00", "11:00", "12:00"]);
  });

  it("fills the gap between two scattered mid-day bookings", () => {
    // 11:00–12:00 is free and a 30-minute service fits twice.
    const result = labels({
      durationMin: 30,
      appointments: [busy("10:00", "11:00"), busy("12:00", "13:00")],
    });

    expect(result).toContain("11:00");
    expect(result).toContain("11:30");
    // And nothing that would run into the 12:00 booking.
    expect(result).not.toContain("11:45");
  });

  it("refuses a service that does not fit the gap it is offered", () => {
    // The rule the brief calls out: a 20-minute hole takes the 15-minute
    // service and must reject the 30-minute one, from the same catalogue on
    // the same day.
    const gap = [busy("09:00", "10:00"), busy("10:20", "17:00")];

    expect(labels({ durationMin: 15, appointments: gap })).toContain("10:00");
    expect(labels({ durationMin: 30, appointments: gap })).toEqual([]);
  });

  it("counts the trailing buffer of the previous booking as blocked", () => {
    // Free at 10:00 by the clock, but a 15-minute buffer means the chair is
    // not free until 10:15 — and the next booking's leading buffer closes the
    // window at 10:45.
    const result = labels({
      durationMin: 30,
      serviceBufferMin: 15,
      appointments: [busy("09:00", "10:00"), busy("11:00", "12:00")],
    });

    expect(result).toContain("10:15");
    expect(result).not.toContain("10:00");
    expect(result).not.toContain("10:30");
  });

  it("still sells the last slot that ends exactly at closing time", () => {
    // The buffer separates bookings from each other. There is nothing after
    // closing to be separated from, so charging one there would delete the
    // final slot of every single day.
    expect(
      labels({
        durationMin: 60,
        serviceBufferMin: 30,
        shifts: [shift("09:00", "11:00")],
      }),
    ).toEqual(["09:00"]);

    expect(
      labels({ durationMin: 60, shifts: [shift("09:00", "11:00")] }),
    ).toEqual(["09:00", "10:00"]);
  });

  it("treats an aggregated multi-service booking as one longer service", () => {
    // Add-ons need no engine change: the caller sums the durations and the
    // buffers and asks for that window. A 30 + 15 combination needs 45
    // minutes, so it fits the 60-minute hole and not the 30-minute one.
    const smallGap = [busy("09:00", "10:00"), busy("10:30", "17:00")];
    const bigGap = [busy("09:00", "10:00"), busy("11:00", "17:00")];

    expect(labels({ durationMin: 45, appointments: smallGap })).toEqual([]);
    expect(labels({ durationMin: 45, appointments: bigGap })).toContain(
      "10:00",
    );
  });

  it("packs every window on a day chopped into three", () => {
    const result = labels({
      durationMin: 30,
      appointments: [
        busy("09:30", "10:00"),
        busy("11:00", "11:30"),
        busy("15:00", "16:00"),
      ],
    });

    // One before the first booking, the 10:00–11:00 hole taken twice, and the
    // long afternoon window packed from 11:30.
    expect(result.slice(0, 6)).toEqual([
      "09:00",
      "10:00",
      "10:30",
      "11:30",
      "12:00",
      "12:30",
    ]);
    expect(result).toContain("16:00");
  });
});

/* -------------------------------------------------------------------------- */

describe("multi-staff base grid", () => {
  const grid = (baseGridMin: number): SlotPacking => ({
    mode: "grid",
    baseGridMin,
    // Local midnight, which is what every provider anchors to.
    originMs: new Date(`${DATE}T00:00:00+03:00`).getTime(),
  });

  it("offers every anchor that fits, not just consecutive blocks", () => {
    // Alternative start times, not back-to-back bookings: a 60-minute service
    // on a 15-minute grid can begin at 09:00, 09:15 or 09:30.
    expect(
      labels({
        durationMin: 60,
        shifts: [shift("09:00", "11:00")],
        packing: grid(15),
      }),
    ).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00"]);
  });

  it("snaps a window that opens off-grid up to the next anchor", () => {
    // The interleaving fix, at its root. A provider free from 09:05 is offered
    // 09:15, so their column lines up with a colleague free from 09:00.
    expect(
      labels({
        durationMin: 60,
        appointments: [busy("09:00", "09:05")],
        packing: grid(15),
      })[0],
    ).toBe("09:15");
  });

  it("never offers an anchor whose service would run into the next booking", () => {
    const result = labels({
      durationMin: 60,
      appointments: [busy("12:00", "13:00")],
      packing: grid(15),
    });

    // 11:00 finishes exactly at 12:00 and is fine; 11:15 would overrun.
    expect(result).toContain("11:00");
    expect(result).not.toContain("11:15");
    expect(result).not.toContain("11:30");
  });

  it("anchors to the day rather than to the shift, so odd shifts still align", () => {
    // Two providers, one starting at 09:00 and one at 09:35. Both land on the
    // same lattice, which is the entire purpose of the mode.
    const early = labels({
      durationMin: 30,
      shifts: [shift("09:00", "12:00")],
      packing: grid(15),
    });
    const late = labels({
      durationMin: 30,
      shifts: [shift("09:35", "12:00")],
      packing: grid(15),
    });

    expect(early.slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
    expect(late.slice(0, 3)).toEqual(["09:45", "10:00", "10:15"]);
    // No drift: every time either provider offers is on the same lattice.
    for (const label of [...early, ...late]) {
      expect(["00", "15", "30", "45"]).toContain(label.slice(3));
    }
  });

  it("anchors each disjoint window independently", () => {
    const result = labels({
      durationMin: 30,
      appointments: [busy("10:05", "11:05"), busy("13:00", "14:00")],
      packing: grid(30),
    });

    // Before the first booking, between the two, and after the second — every
    // one of them on the half hour.
    expect(result).toContain("09:00");
    expect(result).toContain("11:30");
    expect(result).toContain("14:00");
    for (const label of result) {
      expect(["00", "30"]).toContain(label.slice(3));
    }
  });

  it("drops a window too small for any anchor", () => {
    // 10:00–10:20 is free but no 15-minute anchor leaves room for 30 minutes.
    expect(
      labels({
        durationMin: 30,
        appointments: [busy("09:00", "10:00"), busy("10:20", "17:00")],
        packing: grid(15),
      }),
    ).toEqual([]);
  });
});

describe("baseGridMinutes", () => {
  it("uses the tenant's configured interval when it has one", () => {
    expect(baseGridMinutes(20, [15, 30, 45])).toBe(20);
  });

  it("falls back to the GCD of the service blocks", () => {
    expect(baseGridMinutes(0, [30, 45])).toBe(15);
    expect(baseGridMinutes(0, [20, 60])).toBe(20);
  });

  it("floors the fallback at five minutes", () => {
    // gcd(15, 20, 30, 45) is 5, and a finer lattice than that is the
    // five-minute noise a shop already reported once. The floor is what stops
    // an unusual catalogue producing it again.
    expect(baseGridMinutes(0, [15, 20, 30, 45])).toBe(5);
    expect(baseGridMinutes(0, [2, 3])).toBe(5);
  });

  it("has a sane answer with no services at all", () => {
    expect(baseGridMinutes(0, [])).toBe(15);
  });
});

describe("the date helper the whole engine keys on", () => {
  it("reads a weekday from a plain calendar date", () => {
    expect(weekdayOf(DATE)).toBe(1);
  });
});

describe("reclaiming a gap the lattice cannot sell", () => {
  /**
   * The dead time worth arguing about.
   *
   * Ceiling to the grid costs a few minutes on purpose — that is what keeps two
   * providers' columns aligned, and it is the fix a shop asked for. It stops
   * being worth it when the ceiling swallows a window *whole*: the gap is then
   * not offered later, it is offered never.
   */
  const business = {
    timezone: TZ,
    slotIntervalMin: 15,
    bufferMin: 5,
    minNoticeMin: 0,
    maxAdvanceDays: 365,
  };

  const gridPacking: SlotPacking = {
    mode: "grid",
    baseGridMin: 15,
    originMs: new Date(`${DATE}T00:00:00+03:00`).getTime(),
  };

  const at = (time: string) => new Date(`${DATE}T${time}:00+03:00`);

  /** Two bookings leaving one 40-minute hole from 10:20 to 11:00. */
  const boxedIn: BusyInterval[] = [
    { startsAt: at("09:00"), endsAt: at("10:15") },
    { startsAt: at("11:05"), endsAt: at("17:00") },
  ];

  const run = (packing: SlotPacking, appointments: BusyInterval[]) =>
    computeSlots({
      business,
      durationMin: 30,
      serviceBufferMin: null,
      shifts: [{ startTime: "09:00", endTime: "17:00", isClosed: false }],
      appointments,
      timeOff: [],
      date: DATE,
      now: NOW,
      packing,
    }).map((slot) => slot.label);

  it("offers the tight start when the lattice offers nothing at all", () => {
    // Free from 10:20 to 11:00. The first quarter-hour anchor is 10:30, and a
    // 30-minute service from there runs to 11:00 — which fits exactly, so the
    // lattice *does* sell this one.
    expect(run(gridPacking, boxedIn)).toContain("10:30");
  });

  it("reclaims a window the lattice ceils straight past the end", () => {
    // Shift the far booking five minutes earlier and 10:30 no longer fits, so
    // the lattice has nothing to say about a gap that can still hold the
    // service from 10:20. Without the rescue anchor this is sold to nobody.
    const tighter: BusyInterval[] = [
      { startsAt: at("09:00"), endsAt: at("10:15") },
      { startsAt: at("10:55"), endsAt: at("17:00") },
    ];

    expect(run(gridPacking, tighter)).toEqual(["10:20"]);
  });

  it("keeps the columns aligned whenever the lattice can sell the window", () => {
    /**
     * The interleaving fix, unchanged. A provider free from 09:05 is still
     * offered 09:15 — the rescue anchor only fires where there is no lattice
     * time in the window to align with.
     */
    const late: BusyInterval[] = [{ startsAt: at("09:00"), endsAt: at("09:05") }];
    const labels = run(gridPacking, late);

    expect(labels[0]).toBe("09:15");
    expect(labels).not.toContain("09:10");
  });

  it("never offers a start the service cannot finish inside", () => {
    // Ten minutes of genuinely free time and a 30-minute service: nothing, and
    // certainly not a rescue anchor that would overrun the next booking.
    const tiny: BusyInterval[] = [
      { startsAt: at("09:00"), endsAt: at("10:15") },
      { startsAt: at("10:35"), endsAt: at("17:00") },
    ];

    expect(run(gridPacking, tiny)).toEqual([]);
  });

  it("gives a single-chair shop the earliest free instant, as it always did", () => {
    // Dense packing never had the problem: it starts at the window's own edge.
    expect(run({ mode: "dense" }, boxedIn)).toContain("10:20");
  });
});
