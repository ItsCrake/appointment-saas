import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assignLanes,
  gridBounds,
  hourRows,
  HOUR_ROW_PX,
  lineBudget,
  MAX_CARD_LINES,
  minutesToLabel,
  placeItem,
  type CalendarItem,
} from "@/lib/calendar-layout";

const item = (
  id: string,
  startMinutes: number,
  endMinutes: number,
  dayIndex = 0,
): CalendarItem => ({ id, dayIndex, startMinutes, endMinutes });

/** 09:00 → 540. */
const at = (hour: number, minute = 0) => hour * 60 + minute;

describe("gridBounds", () => {
  it("derives the extent from what is on the grid, padded by an hour", () => {
    // Not a fixed 00:00–24:00: a calendar that always renders 24 rows spends
    // most of a phone screen on hours nobody works.
    const bounds = gridBounds([item("a", at(10), at(11))]);

    expect(bounds).toEqual({ startHour: 9, endHour: 12 });
  });

  it("includes the shop's own hours even on an empty week", () => {
    const bounds = gridBounds(
      [],
      [{ startMinutes: at(8), endMinutes: at(18) }],
    );

    expect(bounds).toEqual({ startHour: 7, endHour: 19 });
  });

  it("stretches to cover a booking outside posted hours", () => {
    // An owner may book a walk-in outside opening hours — deliberate
    // elsewhere in the product, so the calendar has to draw it.
    const bounds = gridBounds(
      [item("late", at(21), at(22))],
      [{ startMinutes: at(9), endMinutes: at(17) }],
    );

    expect(bounds.startHour).toBe(8);
    expect(bounds.endHour).toBe(23);
  });

  it("never runs past midnight in either direction", () => {
    const bounds = gridBounds([item("all", at(0), at(24))]);

    expect(bounds.startHour).toBe(0);
    expect(bounds.endHour).toBe(24);
  });

  it("floors the span so one short booking is not a sliver", () => {
    const bounds = gridBounds([item("a", at(12), at(12, 30))]);

    expect(bounds.endHour - bounds.startHour).toBeGreaterThanOrEqual(3);
  });

  it("falls back to a working day when there is nothing at all", () => {
    expect(gridBounds([])).toEqual({ startHour: 8, endHour: 20 });
  });
});

describe("assignLanes", () => {
  it("leaves a day with no overlaps at full width", () => {
    // The common case, and the one that must not be narrowed for the sake of
    // the rare day that does overlap.
    const placed = assignLanes([
      item("a", at(9), at(10)),
      item("b", at(10), at(11)),
      item("c", at(11), at(12)),
    ]);

    expect(placed.map((p) => p.lane)).toEqual([0, 0, 0]);
    expect(placed.map((p) => p.lanes)).toEqual([1, 1, 1]);
  });

  it("puts two overlapping bookings side by side", () => {
    const placed = assignLanes([
      item("a", at(9), at(10)),
      item("b", at(9), at(10)),
    ]);

    expect(placed.map((p) => p.lane).sort()).toEqual([0, 1]);
    expect(placed.every((p) => p.lanes === 2)).toBe(true);
  });

  it("reuses a lane once its occupant has finished", () => {
    const placed = assignLanes([
      item("a", at(9), at(10)),
      item("b", at(9), at(11)),
      item("c", at(10), at(11)),
    ]);

    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    // `c` starts exactly when `a` ends, so it takes `a`'s lane rather than a
    // third one — half-open intervals, same as the availability engine.
    expect(byId.c.lane).toBe(byId.a.lane);
    expect(byId.b.lane).not.toBe(byId.a.lane);
  });

  it("widens only the overlapping group, not the whole day", () => {
    // Two barbers busy at 09:00 make that morning two columns wide; the
    // afternoon booking stays full width.
    const placed = assignLanes([
      item("morning-1", at(9), at(10)),
      item("morning-2", at(9), at(10)),
      item("afternoon", at(15), at(16)),
    ]);

    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId["morning-1"].lanes).toBe(2);
    expect(byId.afternoon.lanes).toBe(1);
  });

  it("handles three-deep overlap", () => {
    const placed = assignLanes([
      item("a", at(9), at(12)),
      item("b", at(9, 30), at(12)),
      item("c", at(10), at(12)),
    ]);

    expect(placed.map((p) => p.lane).sort()).toEqual([0, 1, 2]);
    expect(placed.every((p) => p.lanes === 3)).toBe(true);
  });

  it("does not depend on the order it was given", () => {
    const forwards = assignLanes([
      item("a", at(9), at(11)),
      item("b", at(10), at(12)),
    ]);
    const backwards = assignLanes([
      item("b", at(10), at(12)),
      item("a", at(9), at(11)),
    ]);

    const lanes = (placed: ReturnType<typeof assignLanes>) =>
      Object.fromEntries(placed.map((p) => [p.id, p.lane]));

    expect(lanes(forwards)).toEqual(lanes(backwards));
  });

  it("returns every item it was given", () => {
    const input = [
      item("a", at(9), at(10)),
      item("b", at(9), at(10)),
      item("c", at(9), at(10)),
    ];
    expect(assignLanes(input)).toHaveLength(3);
  });

  it("copes with an empty day", () => {
    expect(assignLanes([])).toEqual([]);
  });
});

describe("placeItem", () => {
  const bounds = { startHour: 8, endHour: 20 };

  it("positions an item as a percentage of the grid", () => {
    const [placed] = assignLanes([item("a", at(8), at(20))]);
    const box = placeItem(placed, bounds);

    expect(box.top).toBe(0);
    expect(box.height).toBe(100);
  });

  it("places a mid-morning booking proportionally", () => {
    const [placed] = assignLanes([item("a", at(14), at(15))]);
    const box = placeItem(placed, bounds);

    // 14:00 is six hours into a twelve-hour grid.
    expect(box.top).toBeCloseTo(50, 5);
    expect(box.height).toBeCloseTo(100 / 12, 5);
  });

  it("clamps a booking that starts before the grid", () => {
    // Possible for real: an owner may book outside posted hours.
    const [placed] = assignLanes([item("a", at(6), at(9))]);
    const box = placeItem(placed, bounds);

    expect(box.top).toBe(0);
    expect(box.top + box.height).toBeLessThanOrEqual(100);
  });

  it("clamps a booking that runs past the grid", () => {
    const [placed] = assignLanes([item("a", at(19), at(23))]);
    const box = placeItem(placed, bounds);

    expect(box.top + box.height).toBeLessThanOrEqual(100.001);
  });

  it("gives a very short booking a floor so its time stays readable", () => {
    const [placed] = assignLanes([item("a", at(12), at(12, 15))]);
    const box = placeItem(placed, bounds);

    expect(box.height).toBeGreaterThanOrEqual(2.5);
  });

  it("splits the width between lanes, leaving a gutter", () => {
    const placed = assignLanes([
      item("a", at(9), at(10)),
      item("b", at(9), at(10)),
    ]);

    const boxes = placed.map((p) => placeItem(p, bounds));
    expect(boxes[0].inlineStart).toBe(0);
    expect(boxes[1].inlineStart).toBe(50);
    for (const box of boxes) {
      expect(box.width).toBeLessThan(50);
      expect(box.width).toBeGreaterThan(45);
    }
  });

  it("never overflows the column", () => {
    const placed = assignLanes([
      item("a", at(9), at(10)),
      item("b", at(9), at(10)),
      item("c", at(9), at(10)),
    ]);

    for (const box of placed.map((p) => placeItem(p, bounds))) {
      expect(box.inlineStart + box.width).toBeLessThanOrEqual(100);
    }
  });
});

describe("hourRows", () => {
  it("lists every row in the grid", () => {
    expect(hourRows({ startHour: 8, endHour: 12 })).toEqual([8, 9, 10, 11]);
  });

  it("is empty for a zero-height grid rather than throwing", () => {
    expect(hourRows({ startHour: 12, endHour: 12 })).toEqual([]);
  });
});

describe("minutesToLabel", () => {
  it("pads to a wall clock", () => {
    expect(minutesToLabel(0)).toBe("00:00");
    expect(minutesToLabel(at(9, 5))).toBe("09:05");
    expect(minutesToLabel(at(23, 59))).toBe("23:59");
  });

  it("clamps rather than wrapping past midnight", () => {
    expect(minutesToLabel(-30)).toBe("00:00");
    expect(minutesToLabel(2000)).toBe("24:00");
  });
});

describe("lineBudget", () => {
  it("gives a half-hour booking all three lines in both views", () => {
    // The case the stacked layout exists for: half an hour is the commonest
    // appointment in the product and it should read as name, time and service
    // rather than as one truncated row.
    expect(lineBudget(30, "week")).toBe(MAX_CARD_LINES);
    expect(lineBudget(30, "day")).toBe(MAX_CARD_LINES);
  });

  it("keeps the name on the shortest booking there is", () => {
    // A quarter of an hour is 24px of week grid. One line, and it is the one
    // somebody scanning a week is actually looking for.
    expect(lineBudget(15, "week")).toBe(1);
    expect(lineBudget(15, "day")).toBe(1);
  });

  it("grows with the booking rather than jumping", () => {
    expect(lineBudget(20, "week")).toBe(2);
    expect(lineBudget(45, "week")).toBe(MAX_CARD_LINES);
    expect(lineBudget(60, "week")).toBe(MAX_CARD_LINES);
  });

  it("never returns nothing, however short or strange the booking", () => {
    // A zero- or negative-length row should not exist, but the grid draws what
    // the database holds and an empty card is worse than a clipped one.
    for (const minutes of [0, -30, 1]) {
      expect(lineBudget(minutes, "week")).toBe(1);
      expect(lineBudget(minutes, "day")).toBe(1);
    }
  });

  it("never promises more lines than the card renders", () => {
    expect(lineBudget(600, "day")).toBe(MAX_CARD_LINES);
  });

  it("keeps the row heights in step with the Tailwind classes", () => {
    /**
     * `HOUR_ROW_PX` is a transcription of the `h-*` utilities the grid actually
     * uses, and the whole line budget is arithmetic on it. If somebody retunes
     * the row height in the component and not here, every card silently claims
     * room it does not have — so the two are checked against each other rather
     * than trusted to stay in sync.
     */
    const source = readFileSync(
      path.resolve(process.cwd(), "src/components/dashboard/week-calendar.tsx"),
      "utf8",
    );

    const scale = (name: string) => {
      const match = source.match(new RegExp(`${name} = "h-(\\d+)"`));
      if (!match) throw new Error(`${name} is no longer a plain h-* class`);
      // Tailwind's spacing scale is 0.25rem a step, and 1rem is 16px.
      return Number(match[1]) * 4;
    };

    expect(scale("HOUR_ROW_WEEK")).toBe(HOUR_ROW_PX.week);
    expect(scale("HOUR_ROW_DAY")).toBe(HOUR_ROW_PX.day);
  });
});
