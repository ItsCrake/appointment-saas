import { describe, expect, it } from "vitest";

import { shiftWeeks, toDaySpans, weekOf } from "@/lib/calendar-week";

const TZ = "Asia/Jerusalem";
/** 2026-08-09 is a Sunday. */
const WEEK = weekOf("2026-08-12");

describe("weekOf", () => {
  it("starts the week on Sunday, which is the Israeli week", () => {
    expect(WEEK[0]).toBe("2026-08-09");
    expect(WEEK).toHaveLength(7);
    expect(WEEK[6]).toBe("2026-08-15");
  });

  it("returns the same week for every day inside it", () => {
    for (const day of WEEK) {
      expect(weekOf(day)).toEqual(WEEK);
    }
  });

  it("treats a Sunday as the first day of its own week, not the last", () => {
    expect(weekOf("2026-08-09")[0]).toBe("2026-08-09");
  });
});

describe("shiftWeeks", () => {
  it("moves whole weeks in both directions", () => {
    expect(shiftWeeks("2026-08-09", 1)).toBe("2026-08-16");
    expect(shiftWeeks("2026-08-09", -1)).toBe("2026-08-02");
    expect(shiftWeeks("2026-08-09", 0)).toBe("2026-08-09");
  });

  it("crosses a month boundary", () => {
    expect(shiftWeeks("2026-08-30", 1)).toBe("2026-09-06");
  });
});

describe("toDaySpans", () => {
  it("places a booking on its local day at its local time", () => {
    // 06:00Z is 09:00 in Israel in August (IDT, UTC+3).
    const spans = toDaySpans(
      new Date("2026-08-12T06:00:00Z"),
      new Date("2026-08-12T07:00:00Z"),
      TZ,
      WEEK,
    );

    expect(spans).toEqual([
      { dayIndex: 3, startMinutes: 540, endMinutes: 600 },
    ]);
  });

  it("uses the winter offset on the same wall clock", () => {
    const winter = weekOf("2026-12-09");
    const spans = toDaySpans(
      new Date("2026-12-09T07:00:00Z"),
      new Date("2026-12-09T08:00:00Z"),
      TZ,
      winter,
    );

    // IST is UTC+2 in December — same 09:00 local, an hour later in UTC.
    expect(spans[0].startMinutes).toBe(540);
  });

  it("splits a multi-day block across every day it covers", () => {
    // A week's vacation is one time_off row. Without splitting it draws as a
    // single block on Sunday and the other six days look bookable.
    const spans = toDaySpans(
      new Date("2026-08-10T07:00:00Z"),
      new Date("2026-08-12T11:00:00Z"),
      TZ,
      WEEK,
    );

    expect(spans.map((span) => span.dayIndex)).toEqual([1, 2, 3]);
    // First day from its start time to midnight...
    expect(spans[0]).toEqual({
      dayIndex: 1,
      startMinutes: 600,
      endMinutes: 1440,
    });
    // ...middle days in full...
    expect(spans[1]).toEqual({
      dayIndex: 2,
      startMinutes: 0,
      endMinutes: 1440,
    });
    // ...last day up to its end.
    expect(spans[2]).toEqual({
      dayIndex: 3,
      startMinutes: 0,
      endMinutes: 840,
    });
  });

  it("closes the previous day when a block ends exactly at midnight", () => {
    // Otherwise every overnight block draws a zero-height sliver at the top of
    // the following column.
    const spans = toDaySpans(
      new Date("2026-08-10T18:00:00Z"), // 21:00 local
      new Date("2026-08-10T21:00:00Z"), // 00:00 local next day
      TZ,
      WEEK,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({
      dayIndex: 1,
      startMinutes: 1260,
      endMinutes: 1440,
    });
  });

  it("clips a block that starts before the displayed week", () => {
    const spans = toDaySpans(
      new Date("2026-08-07T06:00:00Z"),
      new Date("2026-08-10T06:00:00Z"),
      TZ,
      WEEK,
    );

    // Only the days inside the week come back, and the first of them is full.
    expect(spans.map((span) => span.dayIndex)).toEqual([0, 1]);
    expect(spans[0].startMinutes).toBe(0);
  });

  it("returns nothing for an interval entirely outside the week", () => {
    expect(
      toDaySpans(
        new Date("2026-09-01T06:00:00Z"),
        new Date("2026-09-01T07:00:00Z"),
        TZ,
        WEEK,
      ),
    ).toEqual([]);
  });

  it("returns nothing for an inverted or empty interval", () => {
    const instant = new Date("2026-08-12T06:00:00Z");
    expect(toDaySpans(instant, instant, TZ, WEEK)).toEqual([]);
    expect(
      toDaySpans(instant, new Date(instant.getTime() - 1000), TZ, WEEK),
    ).toEqual([]);
  });

  it("returns nothing when there is no week to place it in", () => {
    expect(
      toDaySpans(
        new Date("2026-08-12T06:00:00Z"),
        new Date("2026-08-12T07:00:00Z"),
        TZ,
        [],
      ),
    ).toEqual([]);
  });
});
