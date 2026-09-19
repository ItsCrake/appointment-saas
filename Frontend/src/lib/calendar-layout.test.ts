import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assignLanes,
  blockMinHeight,
  CARD_BORDER_PX,
  CARD_GAP_PX,
  CARD_LINE_PX,
  CARD_PADDING_PX,
  cardBox,
  cardHeightPx,
  cardPxForLines,
  FULL_CONTENT_MIN_MINUTES,
  gapsToNext,
  hourRowPx,
  MAX_CHIP_LINES,
  MIN_BLOCK_PX,
  MIN_CHIP_PX,
  type CardMode,
  type CalendarView,
  type PlacedItem,
  type StatusItem,
  gridBounds,
  hourRows,
  HOUR_ROW_PX,
  lineBudget,
  MAX_CARD_LINES,
  gridMinWidthPx,
  MIN_CARD_PERCENT,
  MIN_CARD_PX,
  MIN_LANE_PX,
  minutesToLabel,
  RAIL_PX,
  SOLO_LANE_PX,
  placeItem,
  slotHeightPx,
  withoutCoveredCancellations,
  type CalendarItem,
  type GridBounds,
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

  it("spends no row on empty hours when asked for none", () => {
    // The overview fits the working day to the screen; the padding hours would
    // be height taken from every card's start time.
    expect(
      gridBounds([], [{ startMinutes: at(9), endMinutes: at(19) }], 0),
    ).toEqual({ startHour: 9, endHour: 19 });
  });

  describe("cropped to the bookings", () => {
    const OPEN = [{ startMinutes: at(8), endMinutes: at(20) }];

    it("runs from the first booking's hour to the last one's", () => {
      // Open 08–20, booked 11:00–15:30: the owner's empty morning and evening
      // are gone, and so is the padding hour either side.
      expect(
        gridBounds(
          [item("a", at(11), at(12)), item("b", at(14, 30), at(15, 30))],
          OPEN,
          1,
          { fitToItems: true },
        ),
      ).toEqual({ startHour: 11, endHour: 16 });
    });

    it("falls back to the opening hours on a week with nothing booked", () => {
      expect(gridBounds([], OPEN, 1, { fitToItems: true })).toEqual({
        startHour: 8,
        endHour: 20,
      });
    });

    it("still never draws a sliver", () => {
      const bounds = gridBounds([item("a", at(12), at(12, 30))], OPEN, 1, {
        fitToItems: true,
      });
      expect(bounds.endHour - bounds.startHour).toBeGreaterThanOrEqual(3);
      expect(bounds.startHour).toBeLessThanOrEqual(12);
      expect(bounds.endHour).toBeGreaterThanOrEqual(13);
    });

    it("changes nothing when it is off", () => {
      const items = [item("a", at(11), at(12))];
      expect(gridBounds(items, OPEN, 1, { fitToItems: false })).toEqual(
        gridBounds(items, OPEN, 1),
      );
    });
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
  /** What the grid will actually draw for a booking of this length. */
  const budgetFor = (
    minutes: number,
    view: "week" | "day" = "week",
    minutesToNext: number | null = null,
  ) => lineBudget(cardHeightPx(minutes, view, minutesToNext), view);

  it("shows every field of a half-hour booking in both views", () => {
    // Half an hour is the commonest appointment in the product. In the week it
    // is two lines at the base hour — the name, then the span and the service
    // — because three stacked lines cost 52px and it is drawn at 46. The day
    // view has the height for all three on lines of their own.
    expect(budgetFor(30, "week")).toBe(2);
    expect(budgetFor(30, "day")).toBe(MAX_CARD_LINES);
  });

  it("lifts a lone quarter hour to the two-line card, via the floor", () => {
    /**
     * On its own height at the base hour a quarter hour manages a single line;
     * lifted to the floor it carries all three fields on two. The pair is kept
     * as two assertions so the dependency on the floor stays visible.
     */
    expect(lineBudget(slotHeightPx(15, "week"), "week")).toBe(1);
    expect(budgetFor(15, "week")).toBe(2);
  });

  it("carries all three fields at every length the product sells", () => {
    // Two lines in the week carry all three; one line in the day view does,
    // because the day's single column sets them side by side.
    for (const minutes of [15, 20, 30, 45, 60, 90]) {
      expect(budgetFor(minutes, "week")).toBeGreaterThanOrEqual(2);
      expect(budgetFor(minutes, "day")).toBeGreaterThanOrEqual(1);
    }
    // And long enough, both views stack them.
    expect(budgetFor(45, "week")).toBe(MAX_CARD_LINES);
    expect(budgetFor(30, "day")).toBe(MAX_CARD_LINES);
  });

  it("gives up lines only where a neighbour caps the floor", () => {
    /**
     * Back to back with another quarter-hour booking at the base hour, the
     * floor is capped so the card cannot draw over its neighbour — 22px once
     * the gap is taken off, and one line is what fits. (With a quarter hour on
     * screen the hour grows so this does not happen — see `hourRowPx`.) A half
     * hour back to back keeps its two lines, and room after it does not buy a
     * third: the floor is two lines, not three.
     */
    expect(budgetFor(15, "week", 15)).toBe(1);
    expect(budgetFor(30, "week", 30)).toBe(2);
    expect(budgetFor(30, "week", 35)).toBe(2);
    expect(lineBudget(slotHeightPx(30, "week") - CARD_GAP_PX, "week")).toBe(2);
  });

  it("never returns nothing, however short or strange the booking", () => {
    // A zero- or negative-length row should not exist, but the grid draws what
    // the database holds and an empty card is worse than a clipped one.
    for (const px of [0, -30, 1]) {
      expect(lineBudget(px, "week")).toBe(1);
      expect(lineBudget(px, "day")).toBe(1);
    }
  });

  it("never promises more lines than the card renders", () => {
    expect(lineBudget(10_000, "day")).toBe(MAX_CARD_LINES);
  });

  it("lifts a short booking to the floor, but never over its neighbour", () => {
    // Alone, or with an hour of clear air after it, a quarter-hour card takes
    // the full floor.
    expect(cardHeightPx(15, "week", null)).toBe(MIN_CARD_PX.week);
    expect(cardHeightPx(15, "week", 60)).toBe(MIN_CARD_PX.week);

    // Back to back with another, it keeps its true height instead — a floor
    // that drew over the next booking would make the grid lie about when
    // things happen, which is worse than a card you have to open. Less the
    // gap, which comes off every card so neighbours never touch.
    expect(cardHeightPx(15, "week", 15)).toBe(
      slotHeightPx(15, "week") - CARD_GAP_PX,
    );

    // And in between, it takes exactly the room there is, less the gap.
    expect(cardHeightPx(15, "week", 20)).toBe(
      slotHeightPx(20, "week") - CARD_GAP_PX,
    );
  });

  it("leaves a booking taller than the floor alone", () => {
    const hour = slotHeightPx(60, "week") - CARD_GAP_PX;
    expect(cardHeightPx(60, "week", null)).toBe(hour);
    // Even squeezed: an hour-long booking is never shrunk to fit a gap, because
    // the floor is a minimum and not a height.
    expect(cardHeightPx(60, "week", 15)).toBe(hour);
  });

  it("measures the gap to the next card that shares its space", () => {
    const placed = assignLanes([
      item("a", at(9), at(9, 15)),
      item("b", at(9, 30), at(10)),
      // Overlaps `b`, so it lands in a second lane and is nobody's neighbour.
      item("c", at(9, 45), at(10, 30)),
    ]);

    const gaps = gapsToNext(placed);

    expect(gaps.get("a")).toBe(30); // 09:00 → 09:30
    expect(gaps.get("b")).toBeNull(); // nothing after it in lane 0
    expect(gaps.get("c")).toBeNull(); // alone in lane 1
  });

  it("sees a full-width card below a card in a side lane", () => {
    /**
     * **The overlap this used to draw.** A quarter hour beside a half hour
     * lands in lane 1; the next booking opens a new group, which is full width
     * and numbered lane 0. Grouping by lane number, the short card found
     * nothing after it, went uncapped, and its floor ran 6px into the booking
     * below — a pair that shares no lane *number* but plainly shares space.
     */
    const placed = assignLanes([
      item("long", at(10), at(10, 30)),
      item("short", at(10, 10), at(10, 25)),
      item("next", at(10, 35), at(11, 5)),
    ]);
    const byId = new Map(placed.map((entry) => [entry.id, entry]));

    expect(byId.get("short")).toMatchObject({ lane: 1, lanes: 2 });
    expect(byId.get("next")).toMatchObject({ lane: 0, lanes: 1 });

    const gaps = gapsToNext(placed);
    expect(gaps.get("short")).toBe(25); // 10:10 → 10:35
    expect(gaps.get("long")).toBe(35);
  });

  it("does not let a side-by-side neighbour cap a card it never touches", () => {
    // Same group, different lanes: they share no horizontal space, so neither
    // is under the other's floor however their start times fall.
    const placed = assignLanes([
      item("left", at(9), at(10)),
      item("right", at(9, 5), at(9, 20)),
    ]);
    const gaps = gapsToNext(placed);

    expect(gaps.get("left")).toBeNull();
    expect(gaps.get("right")).toBeNull();
  });

  it("draws every row at the hour the line budget is measured on", () => {
    /**
     * The line budget is arithmetic on the hour's height, so the grid has to
     * draw exactly that height — in the rail and in every column. It used to be
     * a pair of `h-*` classes transcribed into `HOUR_ROW_PX`; it is now one
     * number from `hourRowPx`, applied as a style, and the budget is handed the
     * same number. A row drawn from anything else would put the times on the
     * left out of step with the cards on the right.
     */
    const source = readFileSync(
      path.resolve(process.cwd(), "src/components/dashboard/week-calendar.tsx"),
      "utf8",
    );

    expect(source).toMatch(/const rowPx = hourRowPx\(/);
    expect(source).toContain("{ style: { height: rowPx } }");
    // The budget's card height is computed on the same grown hour.
    expect(source).toMatch(/cardHeightPx\([^)]*\browPx,\s*\)/);
    // And no fixed hour class survives to disagree with it.
    expect(source).not.toMatch(/HOUR_ROW_(?:WEEK|DAY)\s*=/);
  });
});

describe("hourRowPx", () => {
  it("grows the week's hour only as far as the two-line card", () => {
    /**
     * A quarter hour needs 34px of card and the 2px gap: 144px an hour. It used
     * to grow until the quarter hour held all three lines *stacked* — 216px —
     * which put three hours of a working day on a laptop screen.
     */
    expect(hourRowPx("week", "full", 15)).toBe(144);
    expect(hourRowPx("week", "full", 20)).toBe(108);
    expect(hourRowPx("week", "full", 30)).toBe(HOUR_ROW_PX.week);
  });

  it("keeps the day view and the compact density at their base hour", () => {
    // The day view's one line holds all three fields in a quarter hour at its
    // base, and the compact chip never grows: its promise is one line.
    expect(hourRowPx("day", "full", 15)).toBe(HOUR_ROW_PX.day);
    expect(hourRowPx("day", "full", 5)).toBe(HOUR_ROW_PX.day);
    expect(hourRowPx("week", "chip", 15)).toBe(HOUR_ROW_PX.chip);
    expect(hourRowPx("week", "chip", 5)).toBe(HOUR_ROW_PX.chip);
  });

  it("fits a ten-hour day on one laptop screen in the compact density", () => {
    expect(10 * hourRowPx("week", "chip", 15)).toBeLessThanOrEqual(720);
  });

  it("never shrinks below the base hour", () => {
    // A shop selling only hour-long appointments keeps the grid it had.
    expect(hourRowPx("week", "full", 60)).toBe(HOUR_ROW_PX.week);
    expect(hourRowPx("week", "chip", 60)).toBe(HOUR_ROW_PX.chip);
    expect(hourRowPx("day", "full", 60)).toBe(HOUR_ROW_PX.day);
    expect(hourRowPx("week", "full", null)).toBe(HOUR_ROW_PX.week);
  });

  it("stops growing at the shortest booking it promises a whole card to", () => {
    // Five minutes would need 432px an hour. Below the promise the scale holds
    // at a quarter hour's worth and the floor and its cap take over.
    expect(hourRowPx("week", "full", 5)).toBe(
      hourRowPx("week", "full", FULL_CONTENT_MIN_MINUTES),
    );
    expect(hourRowPx("week", "full", FULL_CONTENT_MIN_MINUTES)).toBe(144);
  });

  it("leaves the overview's hour to the stylesheet", () => {
    // The row is fitted to the frame in CSS; this is only the nominal hour the
    // pixel fallbacks are measured on.
    expect(hourRowPx("week", "block", 15)).toBe(HOUR_ROW_PX.summary);
  });

  it("keeps each mode's promise from a quarter hour up, back to back", () => {
    /**
     * The promise itself, over every length: the shortest booking of the week
     * sets the hour, and a run of them back to back — the case the floor
     * cannot help — still shows what its mode promises. Full cards in the week
     * need two lines for all three fields; the day view one; the compact chip
     * one line always, and both of its own from a half hour.
     */
    for (const minutes of [15, 20, 25, 30, 45, 60, 90]) {
      for (const [view, card, least] of [
        ["week", "full", 2],
        ["day", "full", 1],
        ["week", "chip", minutes >= 30 ? MAX_CHIP_LINES : 1],
      ] as const) {
        const hour = hourRowPx(view, card, minutes);
        const height = cardHeightPx(minutes, view, minutes, card, hour);
        expect(
          lineBudget(height, view, card),
          `${view}/${card} ${minutes}m`,
        ).toBeGreaterThanOrEqual(least);
        // And whatever the budget, the lines it promises genuinely fit.
        const lines = lineBudget(height, view, card);
        expect(cardPxForLines(lines, view, card)).toBeLessThanOrEqual(height);
      }
    }
  });
});

describe("blockMinHeight", () => {
  it("lifts a lone overview card to a visible mark", () => {
    expect(blockMinHeight(null, { startHour: 9, endHour: 19 })).toBe(
      `${MIN_BLOCK_PX}px`,
    );
  });

  it("caps the mark at the next card, as a share of the grid", () => {
    // Fifteen minutes of a ten-hour grid is 2.5%. Whatever height the
    // stylesheet gives the hour, the floor stops the gap short of that.
    expect(blockMinHeight(15, { startHour: 9, endHour: 19 })).toBe(
      `max(0px, min(${MIN_BLOCK_PX}px, calc(2.5% - ${CARD_GAP_PX}px)))`,
    );
  });
});

describe("withoutCoveredCancellations", () => {
  const entry = (
    id: string,
    startMinutes: number,
    endMinutes: number,
    status: string,
    {
      staffId = "chair",
      kind = "appointment",
      dayIndex = 0,
    }: {
      staffId?: string | null;
      kind?: "appointment" | "block";
      dayIndex?: number;
    } = {},
  ): StatusItem => ({
    id,
    dayIndex,
    startMinutes,
    endMinutes,
    status,
    staffId,
    kind,
  });

  const ids = (items: StatusItem[]) => items.map((item) => item.id);

  it("keeps a cancellation whose slot is still open", () => {
    // The reason for the gap at eleven, drawn where the gap is.
    const items = [
      entry("before", at(10), at(11), "confirmed"),
      entry("gone", at(11), at(11, 30), "cancelled"),
    ];
    expect(ids(withoutCoveredCancellations(items))).toEqual(["before", "gone"]);
  });

  it("drops one the same chair has since re-booked", () => {
    // Beside its replacement it would split the column, and every live booking
    // in that hour would lose half its width to one that is not happening.
    const items = [
      entry("gone", at(11), at(11, 45), "cancelled"),
      entry("taken", at(11), at(11, 30), "confirmed"),
      entry("after", at(11, 30), at(12), "completed"),
    ];
    expect(ids(withoutCoveredCancellations(items))).toEqual(["taken", "after"]);
  });

  it("treats a finished booking and a no-show as holding the time", () => {
    for (const status of ["completed", "no_show", "pending"]) {
      const items = [
        entry("gone", at(9), at(9, 30), "cancelled"),
        entry("held", at(9, 15), at(9, 45), status),
      ];
      expect(ids(withoutCoveredCancellations(items))).toEqual(["held"]);
    }
  });

  it("keeps one that only another provider's booking overlaps", () => {
    // On a team that is two chairs busy at once, which is exactly what lanes
    // are for.
    const items = [
      entry("gone", at(9), at(9, 30), "cancelled", { staffId: "dana" }),
      entry("nir", at(9), at(9, 30), "confirmed", { staffId: "nir" }),
    ];
    expect(ids(withoutCoveredCancellations(items))).toEqual(["gone", "nir"]);
  });

  it("drops one under a block, and under a whole-shop block for anybody", () => {
    const shopClosed = [
      entry("gone", at(13), at(13, 30), "cancelled", { staffId: "dana" }),
      entry("break", at(13), at(14), "", { kind: "block", staffId: null }),
    ];
    expect(ids(withoutCoveredCancellations(shopClosed))).toEqual(["break"]);
  });

  it("keeps only the first of two cancellations for the same slot", () => {
    const items = [
      entry("second", at(10, 15), at(10, 45), "cancelled"),
      entry("first", at(10), at(10, 30), "cancelled"),
    ];
    expect(ids(withoutCoveredCancellations(items))).toEqual(["first"]);
  });

  it("never lets a booking on another day hide one", () => {
    const items = [
      entry("gone", at(9), at(9, 30), "cancelled", { dayIndex: 1 }),
      entry("monday", at(9), at(9, 30), "confirmed", { dayIndex: 0 }),
    ];
    expect(ids(withoutCoveredCancellations(items))).toEqual(["gone", "monday"]);
  });

  it("touches nothing that is not cancelled, and keeps the order", () => {
    const items = [
      entry("c", at(12), at(13), "confirmed"),
      entry("a", at(9), at(10), "pending"),
      entry("b", at(9), at(10), "confirmed", { staffId: "other" }),
    ];
    expect(withoutCoveredCancellations(items)).toEqual(items);
  });
});

describe("gridMinWidthPx", () => {
  it("narrows a week whose columns are never shared", () => {
    /**
     * **A lane that never shares its column does not need a sharing width.**
     * `MIN_LANE_PX` is sized so two or three cards can sit side by side and
     * still be read, which is right for a shop with several chairs busy at once
     * and too much for the common case — a single-staff week is one lane every
     * day, and at the sharing width seven columns overflow a laptop and the
     * owner scrolls sideways through their own week.
     */
    expect(gridMinWidthPx([1, 1, 1, 1, 1, 1, 1])).toBe(
      RAIL_PX + 7 * SOLO_LANE_PX,
    );
    expect(SOLO_LANE_PX).toBeLessThan(MIN_LANE_PX);
  });

  it("keeps the sharing width the moment any day shares", () => {
    // One busy Tuesday and the narrowing is off for the whole week, because
    // columns share a width and that Tuesday is the day being looked at.
    expect(gridMinWidthPx([1, 1, 2, 1, 1])).toBe(RAIL_PX + 5 * 2 * MIN_LANE_PX);
  });

  it("never widens a density that already chose to be narrow", () => {
    /**
     * Applied as a cap rather than a floor. `compact` and `summary` drew their
     * lane widths for exactly this problem and do not need help; a rule that
     * pushed them *up* to 112px would undo the mode.
     */
    expect(gridMinWidthPx([1, 1, 1], 42)).toBe(RAIL_PX + 3 * 42);
    expect(gridMinWidthPx([1, 1, 1], 20)).toBe(RAIL_PX + 3 * 20);
  });

  it("is driven by the worst day, because columns share a width", () => {
    /**
     * One Tuesday with three providers busy at ten sets the floor for the whole
     * week. Sizing to the average would leave exactly that day unreadable —
     * which is the day the owner opened the calendar to look at.
     */
    expect(gridMinWidthPx([1, 1, 3, 1, 1])).toBe(RAIL_PX + 5 * 3 * MIN_LANE_PX);
  });

  it("grows with the number of columns", () => {
    expect(gridMinWidthPx([2])).toBeLessThan(gridMinWidthPx([2, 2]));
  });

  it("never asks for less than one lane a column", () => {
    // An empty day reports no lanes; it still needs a column somebody can read
    // — and an empty week shares nothing, so it gets the solo width.
    expect(gridMinWidthPx([0, 0])).toBe(RAIL_PX + 2 * SOLO_LANE_PX);
  });

  it("asks for nothing when there is nothing on screen", () => {
    expect(gridMinWidthPx([])).toBe(0);
  });

  it("leaves a lane wide enough for the three lines the card renders", () => {
    // The height floor and this are the same fix on two axes: a card given room
    // to stack three lines and then squashed to 40px wide is still an ellipsis.
    expect(MIN_LANE_PX).toBeGreaterThanOrEqual(120);
  });
});

describe("cards never overlap the booking after them", () => {
  /**
   * ---------------------------------------------------------------------------
   * **The floor was applied unconditionally and the cap is the whole fix.** A
   * 15-minute booking on a twelve-hour grid is 2.08%, which is a hairline with
   * no room for the time inside it, so it gets lifted to 2.5%. Back to back,
   * that extra 0.42% is three minutes of card drawn over the next one's start —
   * invisible in a sparse week and unmistakable in a full one, which is exactly
   * when somebody is looking at a packed calendar and needs to trust it.
   * ---------------------------------------------------------------------------
   */
  const TWELVE: GridBounds = { startHour: 8, endHour: 20 };

  /** Back-to-back items in one lane, at `minutes` each. */
  const backToBack = (minutes: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `a${i}`,
      dayIndex: 0,
      startMinutes: 9 * 60 + i * minutes,
      endMinutes: 9 * 60 + (i + 1) * minutes,
      lane: 0,
      lanes: 1,
    }));

  it("never places a short back-to-back run past the next card's start", () => {
    const items = backToBack(15, 4);
    const gaps = gapsToNext(items);

    const boxes = items.map((item) =>
      placeItem(item, TWELVE, undefined, gaps.get(item.id) ?? null),
    );

    for (let i = 0; i < boxes.length - 1; i++) {
      const bottom = boxes[i].top + boxes[i].height;
      // The box may stop exactly at the next card's start; the visible gap is
      // taken off when it is drawn — see `cardBox`. What is forbidden here is
      // spilling past where the next card begins.
      expect(bottom, `card ${i} spills into card ${i + 1}`).toBeLessThanOrEqual(
        boxes[i + 1].top + 0.001,
      );
    }
  });

  it("still lifts a short booking that has room after it", () => {
    // The floor is not being removed — a lone 15-minute booking on a wide grid
    // is still unreadable at its true height, and nothing follows it to hurt.
    const [only] = backToBack(15, 1);
    const box = placeItem(only, TWELVE, undefined, null);

    expect(box.height).toBe(MIN_CARD_PERCENT);
    expect(box.height).toBeGreaterThan((15 / 720) * 100);
  });

  it("never shrinks a card below its real duration", () => {
    /**
     * The cap may only take back what the *floor* added. A booking longer than
     * the gap to the next one is a genuine overlap in the data — two bookings
     * on one provider — and the card has to keep its real height so the clash
     * is visible rather than tidied away.
     */
    const item = {
      id: "long",
      dayIndex: 0,
      startMinutes: 9 * 60,
      endMinutes: 11 * 60,
      lane: 0,
      lanes: 1,
    };

    const box = placeItem(item, TWELVE, undefined, 30);
    expect(box.height).toBeCloseTo((120 / 720) * 100, 5);
  });

  it("is unchanged where the floor never applied", () => {
    // A long booking with room after it must place exactly as before, or this
    // fix has quietly moved every card on the grid.
    const item = {
      id: "hour",
      dayIndex: 0,
      startMinutes: 10 * 60,
      endMinutes: 11 * 60,
      lane: 0,
      lanes: 1,
    };

    expect(placeItem(item, TWELVE, undefined, null).height).toBeCloseTo(
      (60 / 720) * 100,
      5,
    );
  });
});

describe("a card never touches the card below it", () => {
  /**
   * ---------------------------------------------------------------------------
   * **The guarantee, asserted over thousands of days rather than a handful.**
   * The overlap this suite missed for months was a *combination* — a side lane,
   * a floor, a new group opening underneath — and no hand-written case had
   * that shape until one was built from a screenshot. So this generates dense
   * days deliberately: parallel chains of bookings like two providers, zero and
   * five and ten minute buffers, short services back to back, duplicates like a
   * cancelled row under its replacement. Then it draws every card the way
   * `EntryCard` does — `max(height% less the gap, min-height)` — in every view
   * and density, and checks each against every later card sharing its space.
   * ---------------------------------------------------------------------------
   */

  /** A small, seeded generator, so a failure names a day that reproduces. */
  function random(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  const DURATIONS = [5, 10, 15, 15, 20, 30, 30, 45, 60, 90];
  const BUFFERS = [0, 0, 5, 10];

  function denseDay(seed: number): CalendarItem[] {
    const next = random(seed);
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(next() * list.length)];
    const items: CalendarItem[] = [];

    // One to three parallel chains — a provider each.
    const chains = 1 + Math.floor(next() * 3);
    for (let chain = 0; chain < chains; chain++) {
      let cursor = at(8) + Math.floor(next() * 24) * 5;
      const length = 2 + Math.floor(next() * 9);
      for (let i = 0; i < length && cursor < at(19); i++) {
        const minutes = pick(DURATIONS);
        items.push(item(`c${chain}-${i}`, cursor, cursor + minutes));
        // Now and then the same slot twice: a cancellation and its replacement.
        if (next() < 0.1) {
          items.push(
            item(`c${chain}-${i}-dup`, cursor, cursor + pick(DURATIONS)),
          );
        }
        cursor += minutes + pick(BUFFERS);
      }
    }
    // And a few strays, which is where lanes stop being tidy.
    for (let i = 0; i < Math.floor(next() * 4); i++) {
      const start = at(8) + Math.floor(next() * 132) * 5;
      items.push(item(`s${i}`, start, start + pick(DURATIONS)));
    }
    return items;
  }

  /**
   * The grids a card can be drawn on. The full and compact hours grow from the
   * day's shortest booking, exactly as the component grows them from the
   * week's; the overview's hour is the stylesheet's, so it is drawn at a phone's
   * floor, the nominal hour and a laptop's to prove the percentage floor holds
   * at every one of them.
   */
  const FRAMES: {
    view: CalendarView;
    card: CardMode;
    /** A fixed hour for the overview; the grown one everywhere else. */
    overviewHourPx?: number;
  }[] = [
    { view: "week", card: "full" },
    { view: "week", card: "chip" },
    { view: "week", card: "block", overviewHourPx: 36 },
    { view: "week", card: "block", overviewHourPx: HOUR_ROW_PX.summary },
    { view: "week", card: "block", overviewHourPx: 72 },
    { view: "day", card: "full" },
  ];

  /**
   * Resolves a `min-height` the way the browser does: a number is pixels, and
   * the overview's `max(0px, min(Npx, calc(P% - Gpx)))` is a share of the grid.
   */
  function minHeightPx(value: number | string, gridPx: number): number {
    if (typeof value === "number") return value;
    const floor = value.match(/^(\d+)px$/);
    if (floor) return Number(floor[1]);
    const capped = value.match(
      /^max\(0px, min\((\d+)px, calc\(([\d.e-]+)% - (\d+)px\)\)\)$/,
    );
    if (!capped) throw new Error(`unreadable min-height: ${value}`);
    return Math.max(
      0,
      Math.min(
        Number(capped[1]),
        (Number(capped[2]) / 100) * gridPx - Number(capped[3]),
      ),
    );
  }

  /** Every card as the browser paints it, in px. */
  function draw(
    placed: PlacedItem<CalendarItem>[],
    frame: (typeof FRAMES)[number],
  ) {
    const overview = frame.card === "block";
    const bounds = gridBounds(placed, [], overview ? 0 : 1);
    const shortest = Math.min(
      ...placed.map((entry) => entry.endMinutes - entry.startMinutes),
    );
    const hourPx =
      frame.overviewHourPx ?? hourRowPx(frame.view, frame.card, shortest);
    const gridPx = (bounds.endHour - bounds.startHour) * hourPx;
    const gaps = gapsToNext(placed);

    return placed.map((entry) => {
      const toNext = gaps.get(entry.id) ?? null;
      const box = placeItem(entry, bounds, undefined, toNext);
      const fromPercent = Math.max(
        0,
        (box.height / 100) * gridPx - CARD_GAP_PX,
      );
      const minHeight = minHeightPx(
        overview
          ? blockMinHeight(toNext, bounds)
          : cardHeightPx(
              entry.endMinutes - entry.startMinutes,
              frame.view,
              toNext,
              frame.card,
              hourPx,
            ),
        gridPx,
      );
      const top = (box.top / 100) * gridPx;
      return {
        entry,
        top,
        bottom: top + Math.max(fromPercent, minHeight),
        left: box.inlineStart,
        right: box.inlineStart + box.width,
      };
    });
  }

  /**
   * The separation somebody can actually see, written as a literal. Measured
   * against `CARD_GAP_PX` itself, setting that to zero made this test pass on
   * flush cards — the check weakened in step with the code it was checking.
   */
  const VISIBLE_GAP_PX = 2;

  it("keeps a gap an owner can see", () => {
    expect(CARD_GAP_PX).toBeGreaterThanOrEqual(VISIBLE_GAP_PX);
  });

  it("holds for every card, in every view and density, across 3000 days", () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= 3000 && failures.length < 5; seed++) {
      const placed = assignLanes(denseDay(seed));

      for (const frame of FRAMES) {
        const cards = draw(placed, frame);
        for (const upper of cards) {
          for (const lower of cards) {
            if (upper === lower) continue;
            if (lower.entry.startMinutes < upper.entry.startMinutes) continue;
            const sharesSpace =
              Math.min(upper.right, lower.right) -
                Math.max(upper.left, lower.left) >
              0;
            if (!sharesSpace) continue;

            const clearance = lower.top - upper.bottom;
            if (clearance < VISIBLE_GAP_PX - 1e-6) {
              failures.push(
                `seed ${seed} ${frame.view}/${frame.card}` +
                  `${frame.overviewHourPx ? `@${frame.overviewHourPx}` : ""}: ` +
                  `${upper.entry.id} ends ${clearance.toFixed(2)}px above ${lower.entry.id}`,
              );
            }
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("generates days that actually exercise side lanes", () => {
    // A fuzz that never produced the dangerous shape would pass for the wrong
    // reason. Count the days with a card in lane 1 followed by a wider group.
    let sideLaneDays = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const placed = assignLanes(denseDay(seed));
      if (placed.some((entry) => entry.lane > 0)) sideLaneDays++;
    }
    expect(sideLaneDays).toBeGreaterThan(1000);
  });
});

describe("the line budget only promises whole lines", () => {
  it("never budgets a line the card cannot draw", () => {
    const frames: [CalendarView, "full" | "chip"][] = [
      ["week", "full"],
      ["week", "chip"],
      ["day", "full"],
    ];

    for (const [view, card] of frames) {
      const most = card === "chip" ? MAX_CHIP_LINES : MAX_CARD_LINES;
      for (let px = 0; px <= 200; px += 0.5) {
        const lines = lineBudget(px, view, card);
        // Beyond the one line every card is allowed, the answer must fit…
        if (lines > 1) {
          expect(cardPxForLines(lines, view, card)).toBeLessThanOrEqual(px);
        }
        // …and be the most that fits, or the card is wasting room it has.
        if (lines < most) {
          expect(cardPxForLines(lines + 1, view, card)).toBeGreaterThan(px);
        }
      }
    }
  });

  it("sizes each floor to exactly the lines its mode draws", () => {
    // Explicit numbers as well as the derivation, so retuning a metric is a
    // decision somebody makes in this file rather than a side effect.
    expect(MIN_CARD_PX.week).toBe(34);
    expect(MIN_CARD_PX.day).toBe(30);
    expect(MIN_CHIP_PX).toBe(16);
    expect(MIN_BLOCK_PX).toBe(8);

    // Two lines in the week and one in the day view — each carries all three
    // fields — and the compact chip's one line.
    expect(lineBudget(MIN_CARD_PX.week, "week")).toBe(2);
    expect(lineBudget(MIN_CARD_PX.day, "day")).toBe(1);
    expect(lineBudget(MIN_CHIP_PX, "week", "chip")).toBe(1);
  });

  it("takes the gap off every card it draws, and never goes negative", () => {
    expect(
      cardBox({ top: 12.5, height: 4, inlineStart: 50, width: 48 }),
    ).toEqual({
      top: "12.5%",
      height: `max(0px, calc(4% - ${CARD_GAP_PX}px))`,
      insetInlineStart: "50%",
      width: "48%",
    });
    // A two-minute block on the summary grid is under the gap on its own.
    expect(cardHeightPx(2, "week", 2, "block")).toBe(0);
  });
});

describe("the card's classes say what its metrics say", () => {
  /**
   * ---------------------------------------------------------------------------
   * `CARD_LINE_PX`, `CARD_PADDING_PX` and `CARD_BORDER_PX` are transcriptions of
   * utilities applied in `week-calendar.tsx`, exactly as `HOUR_ROW_PX` is — and
   * the last time they disagreed, every short card on the calendar sliced its
   * own text in half. The transcription alone would not have caught it: the
   * class *was* in the source. `tailwind-merge` removed it at runtime. So the
   * second test forbids the shape that lets that happen at all.
   * ---------------------------------------------------------------------------
   */
  const source = readFileSync(
    path.resolve(process.cwd(), "src/components/dashboard/week-calendar.tsx"),
    "utf8",
  );

  const constant = (name: string) => {
    const match = source.match(new RegExp(`const ${name} = "([^"]+)"`));
    if (!match) throw new Error(`${name} is no longer a plain class string`);
    return match[1];
  };
  /** Tailwind's spacing scale: 0.25rem a step, 1rem = 16px. */
  const steps = (value: string) => Number(value) * 4;

  it("transcribes the line height, the row, the padding and the border", () => {
    const weekLine = constant("CARD_TYPE_WEEK").match(/\/\[(\d+)px\]$/);
    expect(Number(weekLine?.[1])).toBe(CARD_LINE_PX.week);

    const dayLines = [
      ...constant("CARD_TYPE_DAY").matchAll(/text-\w+\/(\d+(?:\.\d+)?)/g),
    ];
    expect(dayLines.length).toBeGreaterThan(0);
    for (const match of dayLines)
      expect(steps(match[1])).toBe(CARD_LINE_PX.day);

    expect(steps(constant("CARD_ROW_WEEK").replace("h-", ""))).toBe(
      CARD_LINE_PX.week,
    );
    expect(steps(constant("CARD_ROW_DAY").replace("h-", ""))).toBe(
      CARD_LINE_PX.day,
    );

    const pad = source.match(
      /const CARD_PAD = \{\s*week: \{ roomy: "py-([\d.]+)", tight: "py-([\d.]+)", flush: "py-([\d.]+)" \},\s*day: \{ roomy: "py-([\d.]+)", tight: "py-([\d.]+)", flush: "py-([\d.]+)" \},\s*\}/,
    );
    if (!pad)
      throw new Error("CARD_PAD is no longer the shape this test reads");
    // `py-*` pads top and bottom, so each value counts twice.
    expect(steps(pad[1]) * 2).toBe(CARD_PADDING_PX.week.roomy);
    expect(steps(pad[2]) * 2).toBe(CARD_PADDING_PX.week.tight);
    expect(steps(pad[3]) * 2).toBe(CARD_PADDING_PX.week.flush);
    expect(steps(pad[4]) * 2).toBe(CARD_PADDING_PX.day.roomy);
    expect(steps(pad[5]) * 2).toBe(CARD_PADDING_PX.day.tight);
    expect(steps(pad[6]) * 2).toBe(CARD_PADDING_PX.day.flush);
    // And the component picks among them with the arithmetic's own rule.
    expect(source).toMatch(/CARD_PAD\[[^\]]+\]\[cardPadding\(lines, card\)\]/);

    const card = source.slice(
      source.indexOf("function EntryCard("),
      source.indexOf("function NoteMark("),
    );
    const classes = card.slice(
      card.indexOf("const className = cn("),
      card.indexOf("// A block is not an appointment"),
    );
    // A bare `border` is 1px a side, which is the 2px the arithmetic counts.
    expect(classes).toMatch(/["\s]border["\s]/);
    expect(classes).not.toMatch(/\bborder-(?:[2-8]|y-|t-|b-)/);
    expect(CARD_BORDER_PX).toBe(2);
  });

  it("carries the line-height inside the size class, never beside it", () => {
    const card = source.slice(
      source.indexOf("function EntryCard("),
      source.indexOf("function NoteMark("),
    );
    // `cn()` deletes a `leading-*` that precedes a text size. In this card
    // there is always a text size, so a bare `leading-*` is always a bug.
    expect(card).not.toMatch(/\bleading-/);
  });
});

describe("no stylesheet rule changes a card's box", () => {
  /**
   * ---------------------------------------------------------------------------
   * The metrics above are a contract with *every* class a card can wear, not
   * only with its Tailwind utilities. \`.cal-pending\` broke it without anybody
   * touching the component: \`border-width: 2px\` in \`globals.css\` took 2px from
   * every line the budget had counted on, on exactly the cards — requests
   * waiting on the owner — that most need reading. It clipped nothing only
   * because the padding happened to absorb the difference.
   *
   * So the card's hand-written classes may paint, light and tint a card, and
   * may not size it. Emphasis that needs weight is drawn inside, as the inset
   * ring \`.cal-pending\` now uses.
   * ---------------------------------------------------------------------------
   */
  const css = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  /** Classes a calendar card is given by \`EntryCard\`. */
  const CARD_CLASS =
    /\.cal-(?:glass|glass-solid|pending|muted|cancelled|block|staff-[\w-]+|tone-\d|dup-\d)\b/;
  const BOX =
    /(?:^|;|\{)\s*(border(?:-(?:top|bottom|block)(?:-(?:start|end))?)?-width|border(?:-(?:top|bottom|block))?\s*:|padding(?:-[\w-]+)?|(?:min-|max-)?height|box-sizing)\s*:/;

  const cardRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => CARD_CLASS.test(selector));

  it("finds the card rules at all", () => {
    expect(cardRules.length).toBeGreaterThan(10);
    expect(
      cardRules.some(({ selector }) => selector.includes(".cal-pending")),
    ).toBe(true);
  });

  it("lets them paint and light a card, never size it", () => {
    const offenders = cardRules
      .filter(({ body }) => BOX.test(body))
      .map(({ selector, body }) => `${selector} → ${body.match(BOX)?.[1]}`);
    expect(offenders).toEqual([]);
  });

  it("draws their light through Tailwind's variables, so focus rings survive", () => {
    // An unlayered \`box-shadow\` beats \`focus-visible:ring-2\`. Every card rule
    // that sets one must compose the ring's variable into it.
    for (const { selector, body } of cardRules) {
      if (!/(?:^|;)\s*box-shadow\s*:/.test(body)) continue;
      expect(body, selector).toContain("var(--tw-ring-shadow");
    }
  });
});
