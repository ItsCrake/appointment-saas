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
): Placement {
  const gridStart = bounds.startHour * 60;
  const gridSpan = Math.max(1, (bounds.endHour - bounds.startHour) * 60);

  const start = Math.max(
    gridStart,
    Math.min(item.startMinutes, gridStart + gridSpan),
  );
  const end = Math.max(start, Math.min(item.endMinutes, gridStart + gridSpan));

  const laneWidth = 100 / item.lanes;

  return {
    top: ((start - gridStart) / gridSpan) * 100,
    // A floor, or a 15-minute booking on a twelve-hour grid is a hairline with
    // no room for the time inside it.
    height: Math.max(2.5, ((end - start) / gridSpan) * 100),
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

/** "09:00" from minutes past midnight. */
export function minutesToLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
