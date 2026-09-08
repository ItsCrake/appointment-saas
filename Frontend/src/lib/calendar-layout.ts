/**
 * Geometry for the week calendar. No dates, no timezones, no React.
 *
 * ---------------------------------------------------------------------------
 * Everything here works in **minutes from local midnight** and a **day index**,
 * because by the time a booking reaches this module the server has already
 * resolved it into the business's own wall clock. That is the same division the
 * rest of the app uses — `agenda-list` gets pre-formatted strings, `analytics`
 * extracts `AT TIME ZONE` in SQL — and it is what keeps a calendar from
 * quietly rendering a Tel Aviv shop's day in the browser's timezone.
 *
 * The consequence is that every rule below is arithmetic on integers, so the
 * overlap algorithm can be tested without constructing a single Date.
 * ---------------------------------------------------------------------------
 */

export const MINUTES_PER_DAY = 1440;

export type CalendarItem = {
  id: string;
  /** 0..6 within the displayed week, 0 = the first column. */
  dayIndex: number;
  /** Minutes from local midnight. */
  startMinutes: number;
  endMinutes: number;
};

/** An item with its horizontal slot, once overlaps are resolved. */
export type PlacedItem<T extends CalendarItem> = T & {
  /** 0-based column within the day. */
  lane: number;
  /** How many lanes this item's overlapping group needs. */
  lanes: number;
};

export type GridBounds = {
  /** First hour shown, inclusive. */
  startHour: number;
  /** Last hour shown, exclusive. */
  endHour: number;
};

/**
 * The vertical extent of the grid.
 *
 * Derived from what is actually on it — the shop's hours plus anything booked
 * or blocked outside them — rather than a fixed 00:00–24:00. A calendar that
 * always renders twenty-four rows spends most of a phone screen on hours nobody
 * works, and shrinks the part carrying the answer to an unreadable band.
 *
 * Padded by an hour either side so an appointment never touches the frame, and
 * floored at a three-hour span so a day with one booking is not a sliver.
 */
export function gridBounds(
  items: readonly CalendarItem[],
  openMinutes: readonly { startMinutes: number; endMinutes: number }[] = [],
): GridBounds {
  const spans = [
    ...items.map((item) => ({
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
    })),
    ...openMinutes,
  ];

  if (spans.length === 0) return { startHour: 8, endHour: 20 };

  const earliest = Math.min(...spans.map((span) => span.startMinutes));
  const latest = Math.max(...spans.map((span) => span.endMinutes));

  let startHour = Math.max(0, Math.floor(earliest / 60) - 1);
  let endHour = Math.min(24, Math.ceil(latest / 60) + 1);

  // A single 30-minute booking would otherwise produce a two-row grid whose
  // rows are taller than the card inside them.
  if (endHour - startHour < 3) {
    endHour = Math.min(24, startHour + 3);
    startHour = Math.max(0, endHour - 3);
  }

  return { startHour, endHour };
}

/**
 * Side-by-side columns for items that overlap in time.
 *
 * The classic sweep: sort by start, and give each item the **first lane whose
 * previous occupant has already finished**. Items that do not overlap therefore
 * reuse lane 0 and stay full width, which matters because the common day has no
 * overlaps at all and should not be rendered at half width for the sake of the
 * one day that does.
 *
 * `lanes` is the width of the *overlapping group*, not of the whole day. Two
 * barbers busy at 09:00 make that morning two columns wide without narrowing
 * the afternoon.
 */
export function assignLanes<T extends CalendarItem>(
  items: readonly T[],
): PlacedItem<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const placed: PlacedItem<T>[] = [];
  /** Items in the current overlapping group, and each lane's end time. */
  let group: PlacedItem<T>[] = [];
  let laneEnds: number[] = [];

  const closeGroup = () => {
    const width = laneEnds.length;
    for (const item of group) item.lanes = width;
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    // A group ends when nothing in it is still running: the next item starts at
    // or after every lane's end.
    if (
      laneEnds.length > 0 &&
      laneEnds.every((end) => end <= item.startMinutes)
    ) {
      closeGroup();
    }

    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane === -1) lane = laneEnds.length;

    laneEnds[lane] = item.endMinutes;

    const entry = { ...item, lane, lanes: 1 } as PlacedItem<T>;
    group.push(entry);
    placed.push(entry);
  }

  closeGroup();
  return placed;
}

export type Placement = {
  /** Percentage from the top of the grid. */
  top: number;
  /** Percentage of the grid's height. */
  height: number;
  /** Percentage from the inline start of the day column. */
  inlineStart: number;
  /** Percentage of the day column's width. */
  width: number;
};

/**
 * Where one placed item sits, as percentages of its day column.
 *
 * Percentages rather than pixels so the grid is responsive without JavaScript
 * measuring anything — the same layout works on a phone and on a monitor, and
 * nothing has to re-run on resize.
 *
 * Clamped to the grid: an appointment that starts before the first row or runs
 * past the last is drawn at the edge rather than outside it. That happens for
 * real — an owner can book a walk-in outside posted hours, which is deliberate
 * elsewhere in the product and must not throw the calendar off its frame.
 */
export function placeItem(
  item: PlacedItem<CalendarItem>,
  bounds: GridBounds,
  /** Fraction of the lane width left as a gap between neighbours. */
  gutter = 0.04,
  /**
   * Minutes from this item's start to the next in its lane, or null when
   * nothing follows. See the height note below — without it the floor draws
   * short bookings over their neighbours.
   */
  minutesToNext: number | null = null,
): Placement {
  const gridStart = bounds.startHour * 60;
  const gridSpan = Math.max(1, (bounds.endHour - bounds.startHour) * 60);

  const start = Math.max(
    gridStart,
    Math.min(item.startMinutes, gridStart + gridSpan),
  );
  const end = Math.max(start, Math.min(item.endMinutes, gridStart + gridSpan));

  const laneWidth = 100 / item.lanes;

  const own = ((end - start) / gridSpan) * 100;

  /**
   * **The floor, capped by the room before the next booking.**
   *
   * A 15-minute booking on a twelve-hour grid is 2.08% — a hairline with no
   * room for the time inside it — so it gets lifted to 2.5%. Unconditionally,
   * until now: back to back, that extra 0.42% is three minutes of card drawn
   * over the neighbour's start, which is the overlap seen in the packed views.
   * `cardHeightPx` has always capped its pixel floor this way; the percentage
   * one simply never learned to.
   *
   * The cap is the gap itself, not the gap minus a margin: cards are separated
   * by the lane gutter and by `top`, so flush is correct and anything less
   * leaves a hairline of grid showing through a solid day.
   */
  const ceiling =
    minutesToNext === null ? Infinity : (minutesToNext / gridSpan) * 100;

  return {
    top: ((start - gridStart) / gridSpan) * 100,
    height: Math.max(own, Math.min(MIN_CARD_PERCENT, ceiling)),
    inlineStart: item.lane * laneWidth,
    width: laneWidth * (1 - gutter),
  };
}

/** The hour labels down the side, inclusive of the last row. */
export function hourRows(bounds: GridBounds): number[] {
  return Array.from(
    { length: Math.max(0, bounds.endHour - bounds.startHour) },
    (_, index) => bounds.startHour + index,
  );
}

/**
 * Pixel height of one hour of grid, per view.
 *
 * The rail and the day columns are Tailwind classes, so these two numbers are a
 * transcription of them and `calendar-layout.test.ts` fails if the classes and
 * these drift apart. They live here because the line budget below is arithmetic
 * on them, and that arithmetic is the whole reason a booking either shows its
 * service name or does not.
 */
export const HOUR_ROW_PX = { week: 96, day: 160 } as const;

/** Vertical padding inside a card, and the height of one line of its type. */
const CARD_METRICS = {
  week: { padding: 8, lineHeight: 12 },
  day: { padding: 12, lineHeight: 15 },
} as const;

/** The card's three stacked lines, in the order they are given up. */
export const MAX_CARD_LINES = 3;

/**
 * A card is never drawn shorter than this, per view.
 *
 * ---------------------------------------------------------------------------
 * **Sized to hold all three lines** — client name, time span, service — which is
 * `padding + 3 x lineHeight` for each view, rounded up. That is the target: the
 * three things an owner needs from a card without opening it.
 *
 * The floor is a **minimum, not a height**: it only ever grows a card that is
 * smaller, and `cardHeightPx` caps it at the room actually available before the
 * next booking in the same lane. Two back-to-back fifteen-minute appointments
 * therefore keep their true heights and stay honest about when they happen
 * rather than one drawing over the other — a floor that ignored its neighbours
 * would make the grid lie about *when*, which is a worse failure than a
 * compressed card. That case is handled by the layout instead: at two lines the
 * card sets the time and the service on one row, so nothing is hidden, only
 * tightened. See `lineBudget`.
 * ---------------------------------------------------------------------------
 */
export const MIN_CARD_PX = { week: 46, day: 58 } as const;

/**
 * The shortest a card may be drawn as a share of the grid.
 *
 * The percentage twin of {@link MIN_CARD_PX}, and capped the same way — see
 * `placeItem`. 2.5% of a twelve-hour grid is eighteen minutes, which is longer
 * than the shortest service this product sells, so applying it without a
 * ceiling drew every back-to-back short booking over its neighbour.
 */
export const MIN_CARD_PERCENT = 2.5;

/**
 * The narrowest a lane may be when it is the only one in its column.
 *
 * Measured against what one card has to hold rather than against a screen: a
 * 6px accent bar, 16px of padding, and enough left for "09:30–10:15" at 10px
 * plus a Hebrew name on the line above. 112px clears that with room, and takes
 * a seven-day week from about 1150px of grid to about 930 — the difference
 * between a laptop scrolling sideways through its own week and not.
 *
 * Applied as a *cap*, never a floor: a density that has already chosen
 * something narrower — `compact` at 42px, `summary` at 20 — keeps its own
 * number, because those modes drew their widths for exactly this reason and do
 * not need help.
 */
export const SOLO_LANE_PX = 112;

/**
 * The narrowest a single lane may be drawn.
 *
 * ---------------------------------------------------------------------------
 * A day column is split into lanes when bookings overlap, so a shop with three
 * providers busy at ten o'clock gets three lanes inside one column — and across
 * seven columns that is twenty-one slivers sharing the width of a phone. At that
 * size every card is an ellipsis, which is the exact failure the stacked layout
 * and the height floor were built to remove: the fix has to hold on *both* axes
 * or it does not hold.
 *
 * 9rem is what a Hebrew first name, a `09:00–09:45` span and a service name each
 * need at the card's type size without truncating.
 *
 * It is a **minimum on the grid**, not a fixed width. A week that fits stays
 * fluid and fills the screen; only a week that would not fit grows past it, and
 * the container scrolls. Scrolling a busy week is a smaller cost than making
 * every card on it unreadable.
 *
 * **This is now the default rather than the only answer.** It is what the
 * `standard` density asks for, and it assumes the card is trying to show three
 * readable lines. A mode that truncates to one line, or draws no text at all,
 * is not bound by what a Hebrew first name needs — see `lib/calendar-density.ts`,
 * which supplies the number this used to be.
 * ---------------------------------------------------------------------------
 */
export const MIN_LANE_PX = 144;

/** The hour rail down the side, which the grid template reserves. */
export const RAIL_PX = 48;

/**
 * How wide the grid has to be before nothing is squashed.
 *
 * Driven by the **worst** day on screen, because all columns share a width: one
 * Tuesday with three overlapping bookings sets the floor for the whole week, and
 * sizing to the average would leave Tuesday unreadable.
 */
export function gridMinWidthPx(
  /** Lane counts per visible day — `assignLanes` output, or 1 for an empty day. */
  lanesPerDay: readonly number[],
  /**
   * The narrowest one lane may be, from the chosen density. Defaults to
   * {@link MIN_LANE_PX}, which is what `standard` asks for — so every existing
   * caller and every test that predates densities keeps its answer exactly.
   */
  lanePx: number = MIN_LANE_PX,
): number {
  if (lanesPerDay.length === 0) return 0;
  const widest = Math.max(1, ...lanesPerDay);

  /**
   * **A lane that never shares its column does not need a sharing width.**
   *
   * `lanePx` is sized so two or three cards can sit *side by side* and still be
   * read — which is the right number for a shop with several chairs busy at
   * once, and too much for the common case. A single-staff week is one lane
   * every day, and at 144px the seven columns overflow a laptop and the owner
   * scrolls sideways through their own week.
   *
   * The floor here is what one card needs on its own: an accent bar, the
   * padding, "HH:MM–HH:MM" and a Hebrew name on the line above it. Narrower
   * than that and the fix would be trading a scrollbar for an ellipsis, which
   * is not a trade — a truncated name is the field the owner is scanning for.
   */
  const perLane = widest === 1 ? Math.min(lanePx, SOLO_LANE_PX) : lanePx;

  return RAIL_PX + lanesPerDay.length * widest * perLane;
}

export type CalendarView = "week" | "day";

/** What a booking of this length occupies on the grid, before any floor. */
export function slotHeightPx(
  durationMinutes: number,
  view: CalendarView = "week",
): number {
  return (Math.max(0, durationMinutes) * HOUR_ROW_PX[view]) / 60;
}

/**
 * The height a card should actually take: its own, or the floor, whichever is
 * larger — but never past where the next booking in its lane begins.
 *
 * `minutesToNext` is measured from *this* booking's start, which is what the
 * cap needs: items in one lane never overlap, so that distance is exactly the
 * room this card may grow into.
 */
export function cardHeightPx(
  durationMinutes: number,
  view: CalendarView = "week",
  minutesToNext: number | null = null,
): number {
  const own = slotHeightPx(durationMinutes, view);
  const ceiling =
    minutesToNext === null ? Infinity : slotHeightPx(minutesToNext, view);

  return Math.max(own, Math.min(MIN_CARD_PX[view], ceiling));
}

/**
 * How far it is from each item's start to the next item sharing its lane.
 *
 * Null where nothing follows. Keyed by id, which is per *span* on this grid, so
 * a booking crossing midnight is two entries and each gets its own answer.
 */
export function gapsToNext<T extends CalendarItem>(
  placed: readonly PlacedItem<T>[],
): Map<string, number | null> {
  const byLane = new Map<number, PlacedItem<T>[]>();
  for (const item of placed) {
    const lane = byLane.get(item.lane) ?? [];
    lane.push(item);
    byLane.set(item.lane, lane);
  }

  const gaps = new Map<string, number | null>();
  for (const lane of byLane.values()) {
    const ordered = [...lane].sort((a, b) => a.startMinutes - b.startMinutes);
    ordered.forEach((item, index) => {
      const next = ordered[index + 1];
      gaps.set(
        item.id,
        next ? next.startMinutes - item.startMinutes : null,
      );
    });
  }

  return gaps;
}

/**
 * How many of **client name / time / service** a booking has room to show.
 *
 * ---------------------------------------------------------------------------
 * This replaces a boolean that chose between one crammed row and two stacked
 * ones. The crammed row read `09:00 · דני · תספורת` and, in a column ninety
 * pixels wide, arrived as `09:00 · דני · תספ…` — an ellipsis eating the service
 * name, the client's name and the time all at once, because they were competing
 * for a single line.
 *
 * Stacking them means each field either appears whole or does not appear, and
 * *how many* appear is decided by the one thing that actually varies: how tall
 * the booking is. A 15-minute slot gets the name, which is what somebody
 * scanning a week is looking for; half an hour gets all three.
 *
 * Arithmetic on integers, in this module rather than in the component, for the
 * same reason everything else here is: it can be tested without rendering
 * anything or constructing a single Date.
 * ---------------------------------------------------------------------------
 */
export function lineBudget(
  /**
   * The card's **rendered** height, which is `cardHeightPx` and not the
   * booking's own — a fifteen-minute appointment lifted to the floor above has
   * genuinely got room for its time, and budgeting from its duration would
   * leave that room empty.
   */
  heightPx: number,
  view: CalendarView = "week",
): number {
  const { padding, lineHeight } = CARD_METRICS[view];
  const usable = heightPx - padding;

  // At least one line always. A booking too short to hold its own name is still
  // a booking, and an empty card is worse than a clipped one.
  return Math.max(1, Math.min(MAX_CARD_LINES, Math.floor(usable / lineHeight)));
}

/** "09:00" from minutes past midnight. */
export function minutesToLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
