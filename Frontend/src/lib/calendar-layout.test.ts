import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assignLanes,
  CARD_BORDER_PX,
  CARD_GAP_PX,
  CARD_LINE_PX,
  CARD_PADDING_PX,
  cardBox,
  cardHeightPx,
  cardPxForLines,
  gapsToNext,
  MAX_CHIP_LINES,
  MIN_BLOCK_PX,
  MIN_CHIP_PX,
  type CardMode,
  type CalendarView,
  type PlacedItem,
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

  it("gives a half-hour booking all three lines in both views", () => {
    // The case the stacked layout exists for: half an hour is the commonest
    // appointment in the product and it should read as name, time and service
    // rather than as one truncated row.
    expect(budgetFor(30, "week")).toBe(MAX_CARD_LINES);
    expect(budgetFor(30, "day")).toBe(MAX_CARD_LINES);
  });

  it("gets all three lines onto a quarter-hour booking, via the floor", () => {
    /**
     * The shortest booking the product sells is the one that decides the floor.
     * On its own height it now manages a single line — the week row was
     * compressed to `h-24`, so a quarter hour is 24px rather than 32 — and
     * lifted to the floor it still clears all three.
     *
     * **That gap is the floor's whole job**, and it got wider rather than
     * appearing: this card always depended on being lifted. The pair is kept as
     * two assertions precisely so the dependency stays visible, and so raising
     * the row height back does not quietly make the floor look unnecessary.
     */
    expect(lineBudget(slotHeightPx(15, "week"), "week")).toBe(1);
    expect(budgetFor(15, "week")).toBe(MAX_CARD_LINES);
  });

  it("clears three lines at every length the product sells", () => {
    // The floor makes this true from the shortest booking upwards, which is the
    // whole point of raising it: no card has to be opened to be read.
    for (const minutes of [15, 20, 30, 45, 60, 90]) {
      expect(budgetFor(minutes, "week")).toBe(MAX_CARD_LINES);
      expect(budgetFor(minutes, "day")).toBe(MAX_CARD_LINES);
    }
  });

  it("gives up lines only where a neighbour caps the floor", () => {
    /**
     * Back to back with another quarter-hour booking, the floor is capped so
     * the card cannot draw over its neighbour — 22px once the gap is taken off,
     * and one whole line is what fits.
     *
     * **This used to claim a half hour cleared three lines on its own 48px.**
     * It never did: three lines cost 52px once the border is counted and the
     * lines are the 14px the browser draws, and the test passed only because
     * the arithmetic under it believed in 12px lines that `tailwind-merge` had
     * quietly deleted. What the half hour really gets back to back is two —
     * the time and the service share a row, so nothing is hidden. With the
     * shop's usual buffer after it, the floor lifts it to all three.
     */
    expect(budgetFor(15, "week", 15)).toBe(1);
    expect(budgetFor(30, "week", 30)).toBe(2);
    expect(budgetFor(30, "week", 35)).toBe(MAX_CARD_LINES);
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
    expect(gridMinWidthPx([1, 1, 1, 1, 1, 1, 1])).toBe(RAIL_PX + 7 * SOLO_LANE_PX);
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
    const pick = <T,>(list: readonly T[]) =>
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
          items.push(item(`c${chain}-${i}-dup`, cursor, cursor + pick(DURATIONS)));
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

  const FRAMES: { view: CalendarView; card: CardMode; hourPx: number }[] = [
    { view: "week", card: "full", hourPx: HOUR_ROW_PX.week },
    { view: "week", card: "chip", hourPx: HOUR_ROW_PX.week },
    { view: "week", card: "block", hourPx: HOUR_ROW_PX.summary },
    { view: "day", card: "full", hourPx: HOUR_ROW_PX.day },
  ];

  /** Every card as the browser paints it, in px. */
  function draw(
    placed: PlacedItem<CalendarItem>[],
    frame: (typeof FRAMES)[number],
  ) {
    const bounds = gridBounds(placed);
    const gridPx = (bounds.endHour - bounds.startHour) * frame.hourPx;
    const gaps = gapsToNext(placed);

    return placed.map((entry) => {
      const toNext = gaps.get(entry.id) ?? null;
      const box = placeItem(entry, bounds, undefined, toNext);
      const fromPercent = Math.max(0, (box.height / 100) * gridPx - CARD_GAP_PX);
      const minHeight = cardHeightPx(
        entry.endMinutes - entry.startMinutes,
        frame.view,
        toNext,
        frame.card,
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
              Math.min(upper.right, lower.right) - Math.max(upper.left, lower.left) > 0;
            if (!sharesSpace) continue;

            const clearance = lower.top - upper.bottom;
            if (clearance < VISIBLE_GAP_PX - 1e-6) {
              failures.push(
                `seed ${seed} ${frame.view}/${frame.card}: ${upper.entry.id} ` +
                  `ends ${clearance.toFixed(2)}px above ${lower.entry.id}`,
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
    expect(MIN_CARD_PX.week).toBe(52);
    expect(MIN_CARD_PX.day).toBe(74);
    expect(MIN_CHIP_PX).toBe(34);
    expect(MIN_BLOCK_PX).toBe(8);

    expect(lineBudget(MIN_CARD_PX.week, "week")).toBe(MAX_CARD_LINES);
    expect(lineBudget(MIN_CARD_PX.day, "day")).toBe(MAX_CARD_LINES);
    expect(lineBudget(MIN_CHIP_PX, "week", "chip")).toBe(MAX_CHIP_LINES);
  });

  it("takes the gap off every card it draws, and never goes negative", () => {
    expect(cardBox({ top: 12.5, height: 4, inlineStart: 50, width: 48 })).toEqual({
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

    const dayLines = [...constant("CARD_TYPE_DAY").matchAll(/text-\w+\/(\d+(?:\.\d+)?)/g)];
    expect(dayLines.length).toBeGreaterThan(0);
    for (const match of dayLines) expect(steps(match[1])).toBe(CARD_LINE_PX.day);

    expect(steps(constant("CARD_ROW_WEEK").replace("h-", ""))).toBe(CARD_LINE_PX.week);
    expect(steps(constant("CARD_ROW_DAY").replace("h-", ""))).toBe(CARD_LINE_PX.day);

    const pad = source.match(
      /const CARD_PAD = \{\s*week: \{ roomy: "py-([\d.]+)", tight: "py-([\d.]+)" \},\s*day: \{ roomy: "py-([\d.]+)", tight: "py-([\d.]+)" \},\s*\}/,
    );
    if (!pad) throw new Error("CARD_PAD is no longer the shape this test reads");
    // `py-*` pads top and bottom, so each value counts twice.
    expect(steps(pad[1]) * 2).toBe(CARD_PADDING_PX.week.roomy);
    expect(steps(pad[2]) * 2).toBe(CARD_PADDING_PX.week.tight);
    expect(steps(pad[3]) * 2).toBe(CARD_PADDING_PX.day.roomy);
    expect(steps(pad[4]) * 2).toBe(CARD_PADDING_PX.day.tight);

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
    /\.cal-(?:glass|glass-solid|pending|staff-[\w-]+|tone-\d|dup-\d)\b/;
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
