import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CALENDAR_DENSITIES,
  chooseDensity,
  chooseFitHours,
  fitHoursServerSnapshot,
  fitHoursSnapshot,
  readStoredFitHours,
  subscribeFitHours,
  DAY_HEADER_ROW,
  DEFAULT_DENSITY,
  densityServerSnapshot,
  densitySnapshot,
  DENSITY,
  readStoredDensity,
  subscribeDensity,
  SUMMARY_HOUR_ROW,
  toDensity,
  type CalendarDensity,
} from "./calendar-density";
import {
  CARD_GAP_PX,
  cardHeightPx,
  gridMinWidthPx,
  HOUR_ROW_PX,
  MIN_BLOCK_PX,
  MIN_LANE_PX,
  RAIL_PX,
  slotHeightPx,
  SOLO_LANE_PX,
} from "./calendar-layout";

/**
 * The density switcher, and the one arithmetic claim it makes.
 *
 * ---------------------------------------------------------------------------
 * "See the week without scrolling sideways" is a statement about numbers:
 * `RAIL_PX + days × lanes × lanePx` against the width of a phone. It is the
 * whole reason the feature exists and the only part of it that can be quietly
 * wrong — a lane width nudged for looks, and the mode still renders, still
 * looks tidier than `standard`, and still scrolls.
 *
 * **The number to measure against is the content box, not the viewport.** A
 * 390px phone leaves 356px inside the dashboard's own horizontal padding, and
 * an earlier version of this file compared against 390 — so it passed while the
 * browser scrolled 28px, which is precisely the failure it was written to
 * prevent. 356 is measured, not assumed: it is `clientWidth` of the calendar's
 * scroll container at a 390px viewport.
 * ---------------------------------------------------------------------------
 */
const PHONE_CONTENT_PX = 356;

/** Six columns: Sunday to Friday. An Israeli shop's week, with Saturday shut. */
const WORKING_WEEK = 6;

const laneCounts = (days: number, lanes: number) =>
  Array.from({ length: days }, () => lanes);

describe("the density specs", () => {
  it("covers every density exactly once", () => {
    expect(Object.keys(DENSITY).sort()).toEqual([...CALENDAR_DENSITIES].sort());
  });

  it("leaves `standard` identical to the grid that predates the switcher", () => {
    /**
     * The load-bearing assertion of the whole feature. Whatever else a density
     * switcher does, the view an owner already knows has to be untouched by it
     * — a first option that is subtly different from yesterday is a regression
     * wearing a feature's clothes, and it would be found by the person who
     * never touched the new control.
     */
    expect(DENSITY.standard.lanePx).toBe(MIN_LANE_PX);
    expect(DENSITY.standard.card).toBe("full");
    expect(DEFAULT_DENSITY).toBe("standard");
  });

  it("narrows monotonically", () => {
    // The switcher is ordered, and the icons imply an order. If the middle
    // option were not between the other two the control would be lying.
    expect(DENSITY.standard.lanePx).toBeGreaterThan(DENSITY.compact.lanePx);
    expect(DENSITY.compact.lanePx).toBeGreaterThan(DENSITY.summary.lanePx);
  });
});

describe("what actually fits on a 390px phone", () => {
  it("standard does not, which is why the other two exist", () => {
    // Stated rather than implied: `standard` is far past a phone for a quiet
    // week, and that is the problem being solved, not a fault in it.
    //
    // A single-provider week takes the solo lane width — see `gridMinWidthPx`
    // — which narrows `standard` without coming close to rescuing it here.
    // That is the point: the narrowing buys a laptop its seventh column, and
    // a phone still needs a different mode.
    const width = gridMinWidthPx(
      laneCounts(WORKING_WEEK, 1),
      DENSITY.standard.lanePx,
    );
    expect(width).toBe(RAIL_PX + WORKING_WEEK * SOLO_LANE_PX);
    expect(width).toBeGreaterThan(PHONE_CONTENT_PX);
  });

  it("compact fits a single-provider week, including a seven-day one", () => {
    // The mode's entire promise, in two numbers. Seven days is the one that
    // actually constrains the lane width: a shop that opens on Saturday must
    // not be the single case that overflows.
    for (const days of [WORKING_WEEK, 7]) {
      expect(
        gridMinWidthPx(laneCounts(days, 1), DENSITY.compact.lanePx),
      ).toBeLessThanOrEqual(PHONE_CONTENT_PX);
    }
  });

  it("summary fits a week with two providers busy at once", () => {
    /**
     * Where `compact` stops. Two overlapping bookings genuinely need two
     * columns, so a two-provider week is `6 × 2` lanes — 624px in compact,
     * which still scrolls. That is the case `summary` is for, and it is the
     * reason its lane is 24px rather than merely "a bit less than compact".
     */
    expect(
      gridMinWidthPx(laneCounts(WORKING_WEEK, 2), DENSITY.compact.lanePx),
    ).toBeGreaterThan(PHONE_CONTENT_PX);
    expect(
      gridMinWidthPx(laneCounts(WORKING_WEEK, 2), DENSITY.summary.lanePx),
    ).toBeLessThanOrEqual(PHONE_CONTENT_PX);
  });

  it("keeps a full seven-day week inside the phone in summary", () => {
    // Saturday is normally shut, but a shop that opens it gets a seventh
    // column and must not be the one case that overflows.
    expect(
      gridMinWidthPx(laneCounts(7, 2), DENSITY.summary.lanePx),
    ).toBeLessThanOrEqual(PHONE_CONTENT_PX);
  });

  it("defaults to the standard lane when none is given", () => {
    // Every caller and test that predates densities keeps its answer.
    expect(gridMinWidthPx(laneCounts(WORKING_WEEK, 1))).toBe(
      gridMinWidthPx(laneCounts(WORKING_WEEK, 1), MIN_LANE_PX),
    );
  });
});

describe("the overview fits the day to the frame", () => {
  const component = readFileSync(
    path.resolve(process.cwd(), "src/components/dashboard/week-calendar.tsx"),
    "utf8",
  );
  const css = readFileSync(
    path.resolve(process.cwd(), "src/app/globals.css"),
    "utf8",
  );

  it("sizes its hour from the same frame the scroll container is capped at", () => {
    /**
     * `.cal-summary-row` divides the frame's height by the number of hours.
     * That only fits exactly if "the frame" is the same number in both places:
     * the container's `max-h` and the row's `calc`, at the same breakpoint. A
     * frame retuned in one and not the other scrolls the overview again — the
     * failure this replaced, 47px on a 390px phone.
     */
    expect(SUMMARY_HOUR_ROW).toBe("cal-summary-row");
    expect(component).toContain("max-h-[68dvh] sm:max-h-[76dvh]");

    // Regexes rather than offsets, so a checkout with CRLF line endings reads
    // the same rules.
    // The first rule is the base one; the wide screen's override follows it.
    const base = css.match(/\.cal-summary-row \{([^}]*)\}/);
    const wide = css.match(
      /@media \(min-width: 40rem\) \{\s*\.cal-summary-row \{([^}]*)\}/,
    );
    expect(base?.[1]).toContain("68dvh - 3rem - 3px");
    expect(base?.[1]).toContain("var(--cal-rows");
    expect(wide?.[1]).toContain("76dvh - 3rem - 3px");
  });

  it("subtracts exactly the day header the grid draws", () => {
    // 3rem is `h-12`. A header that grew with its type would push the day's
    // last hour below the fold.
    expect(DAY_HEADER_ROW).toBe("h-12");
    expect(component).toContain("DAY_HEADER_ROW");
    // And the grid tells the stylesheet how many hours it is sharing out.
    expect(component).toContain('"--cal-rows": rows.length');
  });

  it("keeps its pixel fallbacks on its own nominal hour", () => {
    /**
     * The overview's cards take their floor as a percentage — see
     * `blockMinHeight` — but `cardHeightPx` still answers for them on the
     * nominal hour, and never lifts a quarter hour past its own length there.
     */
    expect(cardHeightPx(15, "week", null, "block")).toBe(
      slotHeightPx(15, "summary") - CARD_GAP_PX,
    );
    expect(cardHeightPx(1, "week", null, "block")).toBe(MIN_BLOCK_PX);
    expect(cardHeightPx(1, "week", 3, "block")).toBe(
      slotHeightPx(3, "summary") - CARD_GAP_PX,
    );
    expect(HOUR_ROW_PX.summary).toBe(48);
  });
});

describe("toDensity", () => {
  it("accepts every legal mode", () => {
    for (const density of CALENDAR_DENSITIES) {
      expect(toDensity(density)).toBe(density);
    }
  });

  it("degrades anything else to the default", () => {
    /**
     * `localStorage` is editable by hand, outlives a release that renames a
     * mode, and is shared with everything else stored under this origin. An
     * unknown value has to render the default calendar, not a grid with an
     * undefined lane width.
     */
    const junk: unknown[] = [
      null,
      undefined,
      "",
      "STANDARD",
      "cosy",
      42,
      {},
      ["compact"],
    ];
    for (const value of junk) {
      expect(toDensity(value)).toBe(DEFAULT_DENSITY);
    }
  });
});

describe("readStoredDensity", () => {
  it("returns the default where storage cannot be reached", () => {
    // No `window` in this environment, which is the same shape as private mode
    // or a browser configured to refuse storage. A preference is not worth a
    // blank page — the cookie banner takes the same bargain.
    expect(readStoredDensity()).toBe(DEFAULT_DENSITY);
  });

  it("reads a stored mode back", () => {
    const store = new Map<string, string>([
      ["bazman.calendar-density", "summary"],
    ]);
    const win = globalThis as { window?: unknown };
    const original = win.window;
    win.window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null },
    };

    try {
      expect(readStoredDensity()).toBe<CalendarDensity>("summary");
    } finally {
      if (original === undefined) delete win.window;
      else win.window = original;
    }
  });
});

describe("the density store", () => {
  it("renders the default on the server", () => {
    /**
     * Hydration depends on this being a constant. The server cannot know the
     * preference, and a guess would put markup describing one grid width in
     * front of a client about to build another — which is a hydration error,
     * not a layout shift.
     */
    expect(densityServerSnapshot()).toBe(DEFAULT_DENSITY);
  });

  it("returns a stable snapshot and moves it on choice", () => {
    // `getSnapshot` is called on every render, so it has to be cheap and it has
    // to be referentially stable between changes — a fresh value each call is
    // an infinite render loop in `useSyncExternalStore`.
    const first = densitySnapshot();
    expect(densitySnapshot()).toBe(first);

    chooseDensity("compact");
    expect(densitySnapshot()).toBe<CalendarDensity>("compact");

    chooseDensity(DEFAULT_DENSITY);
    expect(densitySnapshot()).toBe(DEFAULT_DENSITY);
  });

  it("tells every subscriber, and stops when they leave", () => {
    // Two calendars on one page — or a switcher and a grid — have to agree.
    let calls = 0;
    const unsubscribe = subscribeDensity(() => {
      calls += 1;
    });

    chooseDensity("summary");
    expect(calls).toBe(1);

    // A repeat of the current mode is not a change and must not re-notify.
    chooseDensity("summary");
    expect(calls).toBe(1);

    unsubscribe();
    chooseDensity(DEFAULT_DENSITY);
    expect(calls).toBe(1);
  });
});

describe("the crop-empty-hours preference", () => {
  it("is off on the server and wherever storage cannot be reached", () => {
    // The same bargain as the density: the server cannot know, and a guess
    // would draw one grid height into markup the client is about to replace.
    expect(fitHoursServerSnapshot()).toBe(false);
    expect(readStoredFitHours()).toBe(false);
  });

  it("reads back only an explicit yes", () => {
    const store = new Map<string, string>();
    const win = globalThis as { window?: unknown };
    const original = win.window;
    win.window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null },
    };

    try {
      store.set("bazman.calendar-fit-hours", "1");
      expect(readStoredFitHours()).toBe(true);
      // Anything hand-edited or left by an older release is simply "off".
      store.set("bazman.calendar-fit-hours", "yes");
      expect(readStoredFitHours()).toBe(false);
    } finally {
      if (original === undefined) delete win.window;
      else win.window = original;
    }
  });

  it("returns a stable snapshot and tells every subscriber once per change", () => {
    let calls = 0;
    const unsubscribe = subscribeFitHours(() => {
      calls += 1;
    });
    const first = fitHoursSnapshot();
    expect(fitHoursSnapshot()).toBe(first);

    chooseFitHours(!first);
    expect(fitHoursSnapshot()).toBe(!first);
    expect(calls).toBe(1);

    // The same answer again is not a change.
    chooseFitHours(!first);
    expect(calls).toBe(1);

    unsubscribe();
    chooseFitHours(first);
    expect(calls).toBe(1);
    expect(fitHoursSnapshot()).toBe(first);
  });
});
