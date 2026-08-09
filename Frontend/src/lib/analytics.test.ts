import { describe, expect, it } from "vitest";

import {
  analyticsWindow,
  buildHeatGrid,
  busiestHour,
  busiestWeekday,
  granularityFor,
  periodLabel,
  rate,
  summariseStatuses,
  toRange,
} from "@/lib/analytics";

const cell = (weekday: number, hour: number, bookings: number) => ({
  weekday,
  hour,
  bookings,
});

describe("toRange", () => {
  it("accepts the offered ranges and falls back for anything else", () => {
    // It reads a query string, so every value is possible.
    expect(toRange("30")).toBe(30);
    expect(toRange(365)).toBe(365);
    expect(toRange("7")).toBe(90);
    expect(toRange("nonsense")).toBe(90);
    expect(toRange(undefined)).toBe(90);
    expect(toRange(null)).toBe(90);
  });
});

describe("granularityFor", () => {
  it("switches to months past a quarter", () => {
    // 52 weekly bars on a phone is a smear; three partial monthly ones for 30
    // days is worse.
    expect(granularityFor(30)).toBe("week");
    expect(granularityFor(90)).toBe("week");
    expect(granularityFor(365)).toBe("month");
  });
});

describe("analyticsWindow", () => {
  it("ends now, not at midnight", () => {
    // An owner checking their phone at 16:00 must see the morning's bookings.
    const now = new Date("2026-08-09T16:30:00Z");
    const window = analyticsWindow(30, now);

    expect(window.to).toBe(now);
    expect(window.from.toISOString()).toBe("2026-07-10T16:30:00.000Z");
  });
});

describe("buildHeatGrid", () => {
  it("derives the hour axis from the data, not from the clock", () => {
    // A shop open 09:00–11:00 gets three columns. A fixed 24-hour axis would
    // spend most of a phone screen on hours nobody has ever booked.
    const grid = buildHeatGrid([cell(0, 9, 2), cell(2, 11, 5)]);

    expect(grid.hours).toEqual([9, 10, 11]);
    expect(grid.max).toBe(5);
    expect(grid.total).toBe(7);
  });

  it("always returns all seven weekdays", () => {
    // A row of zeroes is information: it is the day the shop is shut.
    const grid = buildHeatGrid([cell(3, 10, 4)]);

    expect(grid.rows).toHaveLength(7);
    expect(grid.rows.map((row) => row.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(grid.rows[0].cells).toEqual([0]);
    expect(grid.rows[3].cells).toEqual([4]);
  });

  it("places each count at the right weekday and hour", () => {
    const grid = buildHeatGrid([cell(0, 9, 1), cell(0, 10, 2), cell(6, 9, 3)]);

    expect(grid.rows[0].cells).toEqual([1, 2]);
    expect(grid.rows[6].cells).toEqual([3, 0]);
  });

  it("returns an empty grid rather than a 24-column one when there is nothing", () => {
    expect(buildHeatGrid([])).toEqual({
      hours: [],
      rows: [],
      max: 0,
      total: 0,
    });
    // A row that exists but counts zero is still nothing to draw.
    expect(buildHeatGrid([cell(1, 9, 0)]).hours).toEqual([]);
  });
});

describe("busiestWeekday / busiestHour", () => {
  it("totals across the other axis", () => {
    // Tuesday wins on the sum even though no single Tuesday cell is the peak.
    const cells = [
      cell(0, 9, 5),
      cell(2, 9, 3),
      cell(2, 10, 3),
      cell(2, 11, 3),
    ];

    expect(busiestWeekday(cells)).toBe(2);
    expect(busiestHour(cells)).toBe(9);
  });

  it("breaks a tie towards the earlier day and hour", () => {
    // Deterministic, rather than whichever row the database returned first.
    const cells = [cell(5, 14, 4), cell(1, 9, 4)];

    expect(busiestWeekday(cells)).toBe(1);
    expect(busiestHour(cells)).toBe(9);
  });

  it("answers null when there is nothing to rank", () => {
    expect(busiestWeekday([])).toBeNull();
    expect(busiestHour([])).toBeNull();
    expect(busiestWeekday([cell(1, 9, 0)])).toBeNull();
  });
});

describe("rate", () => {
  it("is a rounded percentage, and zero rather than NaN", () => {
    expect(rate(1, 3)).toBe(33);
    expect(rate(2, 3)).toBe(67);
    expect(rate(0, 0)).toBe(0);
    expect(rate(5, 0)).toBe(0);
  });
});

describe("summariseStatuses", () => {
  const counts = [
    { status: "completed", bookings: 60 },
    { status: "cancelled", bookings: 20 },
    { status: "no_show", bookings: 5 },
    { status: "confirmed", bookings: 15 },
  ];

  it("splits the four outcomes and their rates", () => {
    const summary = summariseStatuses(counts);

    expect(summary.total).toBe(100);
    expect(summary.completed).toBe(60);
    expect(summary.cancelled).toBe(20);
    expect(summary.noShow).toBe(5);
    expect(summary.upcoming).toBe(15);
    expect(summary.completionRate).toBe(60);
    expect(summary.cancellationRate).toBe(20);
    expect(summary.noShowRate).toBe(5);
  });

  it("counts an unrecognised status as still open rather than losing it", () => {
    // `upcoming` is derived by subtraction on purpose: a status added later —
    // pending_deposit, pending_approval — must not silently vanish from the
    // total and make the percentages lie.
    const summary = summariseStatuses([
      { status: "completed", bookings: 1 },
      { status: "pending_deposit", bookings: 2 },
      { status: "something_new", bookings: 1 },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.upcoming).toBe(3);
  });

  it("handles an empty period without dividing by zero", () => {
    const summary = summariseStatuses([]);

    expect(summary.total).toBe(0);
    expect(summary.completionRate).toBe(0);
    expect(summary.cancellationRate).toBe(0);
  });
});

describe("periodLabel", () => {
  it("shows a day and month for a week, a Hebrew month for a month", () => {
    expect(periodLabel("2026-08-09", "week")).toBe("9.8");
    expect(periodLabel("2026-08-01", "month")).toBe("אוג׳ 26");
    expect(periodLabel("2026-01-01", "month")).toBe("ינו׳ 26");
    expect(periodLabel("2026-12-01", "month")).toBe("דצמ׳ 26");
  });
});
