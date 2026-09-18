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
  /**
   * Empty hours either side of the working day. The overview asks for none:
   * it has to fit the whole day on one screen, and every row spent on an hour
   * nobody works is height taken from the cards' start times.
   */
  padHours = 1,
  {
    fitToItems = false,
  }: {
    /**
     * **Only the hours something is booked in** — the owner's "crop empty
     * hours" switch. The working day is what a grid normally spans, so an
     * owner who opens at nine but whose first client is at eleven scrolls past
     * two empty rows to reach them; with this on, the grid starts at eleven.
     * The working day still bounds a week with nothing in it, so an empty week
     * draws the shop's hours rather than nothing. No padding hour either side:
     * the padding is exactly the dead time being cropped.
     */
    fitToItems?: boolean;
  } = {},
): GridBounds {
  const itemSpans = items.map((item) => ({
    startMinutes: item.startMinutes,
    endMinutes: item.endMinutes,
  }));
  const cropped = fitToItems && itemSpans.length > 0;
  const spans = cropped ? itemSpans : [...itemSpans, ...openMinutes];
  const pad = fitToItems ? 0 : padHours;

  if (spans.length === 0) return { startHour: 8, endHour: 20 };

  const earliest = Math.min(...spans.map((span) => span.startMinutes));
  const latest = Math.max(...spans.map((span) => span.endMinutes));

  let startHour = Math.max(0, Math.floor(earliest / 60) - pad);
  let endHour = Math.min(24, Math.ceil(latest / 60) + pad);

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
   * Minutes from this item's start to the next card below it — see
   * `gapsToNext` for what "below" has to mean — or null when nothing follows.
   * Without it the floor draws short bookings over their neighbours.
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
   * once: back to back, that extra 0.42% is three minutes of card drawn over
   * the neighbour's start. The cap stops at the neighbour's start exactly, and
   * the *visible* separation is `CARD_GAP_PX`, taken off every card when it is
   * drawn — see `cardBox`. Keeping the gap out of this arithmetic is what lets
   * it be one number for every card rather than a margin each floor has to
   * remember to subtract.
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

/**
 * The space kept clear under every card, in px.
 *
 * ---------------------------------------------------------------------------
 * **Cards used to be drawn flush, on purpose, and flush is what read as
 * overlap.** The reasoning was sound on paper — a card that ends where the next
 * begins is exactly as tall as the time it covers — but on screen two glass
 * cards border-to-border are one shape with a line through it, and a card whose
 * last line had been sliced by its own clip looked like the one below had been
 * laid on top of it. Measured on the seeded `demo-barber` week, 16 of 40
 * vertically adjacent pairs touched at exactly 0px.
 *
 * Two pixels, taken off the bottom of every card and never the top: the top
 * edge is where the eye reads *when*, so it stays on the minute. At 96px an
 * hour that is 1.25 minutes of card, which is not a claim about time anybody
 * can read off a grid — and it holds with zero buffer and back-to-back
 * bookings, which is the case the floor's cap alone could never separate.
 * ---------------------------------------------------------------------------
 */
export const CARD_GAP_PX = 2;

/**
 * The inline style that draws a placed card.
 *
 * The gap comes off here, once, for every card and every floor — so a floor
 * that stops exactly at the next booking's start still leaves `CARD_GAP_PX`
 * of grid showing. `max(0px, …)` because `calc()` producing a negative height
 * is not zero, it is invalid, and an invalid height is `auto`: a two-minute
 * block would render as tall as its text.
 */
export function cardBox(box: Placement): {
  top: string;
  height: string;
  insetInlineStart: string;
  width: string;
} {
  return {
    top: `${box.top}%`,
    height: `max(0px, calc(${box.height}% - ${CARD_GAP_PX}px))`,
    insetInlineStart: `${box.inlineStart}%`,
    width: `${box.width}%`,
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
 * Pixel height of one hour of grid, per scale — **the least it is ever drawn
 * at**, not the height it always is.
 *
 * `week` and `day` grow past these in `hourRowPx` until the shortest booking on
 * screen can hold every line its card promises. `summary` is the overview's
 * *nominal* hour: the component sizes that row in CSS so the whole day fits the
 * frame (`.cal-summary-row`), which is why its cards take their floor from
 * `blockMinHeight` — a percentage of the grid — rather than from pixels.
 */
export const HOUR_ROW_PX = { week: 96, day: 160, summary: 48 } as const;

export type RowScale = keyof typeof HOUR_ROW_PX;

/**
 * What a card puts inside itself — the density's `card` mode. Mirrored from
 * `calendar-density` rather than imported, so the geometry module depends on
 * nothing.
 */
export type CardMode = "full" | "chip" | "block";

/**
 * ---------------------------------------------------------------------------
 * **The card's real metrics, and the bug that made them worth writing down.**
 *
 * These numbers used to say a line of week-view type was 12px and a card had
 * 8px of vertical padding. Neither was what the browser drew. The card's class
 * list carried `leading-tight`, and `cn()` — which is `tailwind-merge` — deletes
 * a `leading-*` utility when a text-size utility comes after it, because in
 * Tailwind v4 the size carries a line-height of its own. So the leading never
 * applied: lines rendered at the inherited 15px, the 1px border top and bottom
 * was never counted, and `lineBudget` promised lines the card did not have. The
 * extra lines did not overflow — they are `truncate` flex items, and
 * `overflow: hidden` resets a flex item's `min-height` to zero — so they were
 * *squeezed*, each span clipping its own glyphs in half, invisible to
 * `scrollHeight` and unmistakable on screen.
 *
 * **The line-height now travels inside the size class** (`text-[10px]/[14px]`),
 * where `tailwind-merge` cannot separate it from the size, and every line is
 * `shrink-0` so a card that is somehow short clips whole lines rather than
 * slicing all of them. The component's classes are transcribed against these
 * numbers in `calendar-layout.test.ts`.
 *
 * **14px is Heebo's floor, not a taste.** Measured in the browser: at 10px the
 * font's ink reaches 10px above the baseline and 3px below, and the smallest
 * line box that clears both inside a `truncate` clip is 14px. Accented Latin
 * is the tallest thing it has to hold — É and Ñ, which a product with a Spanish
 * page will meet in client names. The day view's 20px clears 14px type, whose
 * floor is 19.
 * ---------------------------------------------------------------------------
 */
export const CARD_LINE_PX = { week: 14, day: 20 } as const;

/** `border` — one pixel top and bottom, inside the card's height. */
export const CARD_BORDER_PX = 2;

/**
 * Vertical padding of the text column, top and bottom together.
 *
 * `roomy` when the card carries several lines; `tight` when it carries one,
 * because a single centred line needs no breathing room above and below it —
 * and the difference is what lets a back-to-back quarter hour, 22px drawn,
 * show a whole name instead of most of one. `chip` is always tight.
 */
export const CARD_PADDING_PX = {
  week: { roomy: 8, tight: 4 },
  day: { roomy: 12, tight: 8 },
} as const;

/** The card's three stacked lines, in the order they are given up. */
export const MAX_CARD_LINES = 3;

/** `chip` stops at the start time — name, then time. */
export const MAX_CHIP_LINES = 2;

/**
 * How tall a card must be drawn to show `lines` whole lines.
 *
 * The one place the metrics above are added up, so the floor, the budget and
 * the test that fuzzes both agree by construction rather than by care.
 */
export function cardPxForLines(
  lines: number,
  view: CalendarView = "week",
  card: Exclude<CardMode, "block"> = "full",
): number {
  const padding =
    card === "chip" || lines <= 1
      ? CARD_PADDING_PX[view].tight
      : CARD_PADDING_PX[view].roomy;
  return CARD_BORDER_PX + padding + Math.max(0, lines) * CARD_LINE_PX[view];
}

/**
 * A card is never drawn shorter than this, per view.
 *
 * ---------------------------------------------------------------------------
 * **Sized to hold all three lines** — client name, time span, service — which
 * is what `cardPxForLines` says three lines cost: 52px in the week, 74 in the
 * day. That is the target: the three things an owner needs from a card without
 * opening it. It was 46 and 58 while the metrics were wrong, which is to say
 * the floor was sized for lines the card could not fit.
 *
 * The floor is a **minimum, not a height**: it only ever grows a card that is
 * smaller, and `cardHeightPx` caps it at the room actually available before
 * the next card below. Two back-to-back fifteen-minute appointments therefore
 * keep their true heights and stay honest about when they happen rather than
 * one drawing over the other — a floor that ignored its neighbours would make
 * the grid lie about *when*, which is a worse failure than a compressed card.
 * That case is handled by the layout instead: at two lines the card sets the
 * time and the service on one row, so nothing is hidden, only tightened. See
 * `lineBudget`.
 * ---------------------------------------------------------------------------
 */
export const MIN_CARD_PX = {
  week: cardPxForLines(MAX_CARD_LINES, "week"),
  day: cardPxForLines(MAX_CARD_LINES, "day"),
} as const;

/** `compact`'s floor: what its two lines cost, and not a pixel of the third. */
export const MIN_CHIP_PX = cardPxForLines(MAX_CHIP_LINES, "week", "chip");

/**
 * `summary`'s floor, on its own half-height grid.
 *
 * 8px keeps the shortest booking visible as a mark. It is not a line budget —
 * a summary card carries no text — and applying the week's would draw every
 * short booking at several times its real length, in the one view whose job is
 * answering how full the week is.
 */
export const MIN_BLOCK_PX = 8;

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
  scale: RowScale = "week",
  /** The hour actually drawn, when `hourRowPx` has grown it. */
  hourPx: number = HOUR_ROW_PX[scale],
): number {
  return (Math.max(0, durationMinutes) * hourPx) / 60;
}

/**
 * The shortest booking a card promises its whole content to.
 *
 * Ten minutes, because that is below anything the demo shops or the product's
 * presets sell, and because the hour it takes to fit three lines into one — 324px
 * in the week — is already most of a laptop screen. Anything shorter is drawn at
 * that scale and falls back to the floor and its cap, which gives up the service
 * line before it gives up the time.
 */
export const FULL_CONTENT_MIN_MINUTES = 10;

/**
 * How tall an hour of grid is drawn, grown until the shortest booking fits.
 *
 * ---------------------------------------------------------------------------
 * **The row answers to the cards, rather than the cards to the row.** A fixed
 * 96px hour made a quarter hour 24px, and the floor that lifted it to three
 * lines had to be capped at the next booking's start, so two back-to-back
 * quarter hours kept one line each: the service and the time went exactly when
 * the day was busy enough for them to matter. Growing the hour instead gives
 * every booking its own full card with nothing drawn over anything.
 *
 * **One scale for the whole week, never one per day.** Seven columns share an
 * hour rail; a Tuesday drawn taller than its Monday would put 10:00 at two
 * heights on one screen. The caller passes the shortest booking across the
 * loaded week, so stepping between days in the day view keeps its scale too.
 *
 * - `full` — and the day view, which only draws full cards — fits all three
 *   lines: name, time span, service.
 * - `chip` fits its two: first name, start time.
 * - `block` is the overview. Its row is sized in CSS to fit the frame, so this
 *   returns the nominal hour its fallbacks are measured against.
 * ---------------------------------------------------------------------------
 */
export function hourRowPx(
  view: CalendarView,
  card: CardMode,
  /** The shortest appointment on screen, in minutes, or null for none. */
  shortestMinutes: number | null,
): number {
  if (view === "week" && card === "block") return HOUR_ROW_PX.summary;

  const base = HOUR_ROW_PX[view];
  if (shortestMinutes === null || shortestMinutes <= 0) return base;

  const content =
    view === "week" && card === "chip"
      ? cardPxForLines(MAX_CHIP_LINES, "week", "chip")
      : cardPxForLines(MAX_CARD_LINES, view);
  const minutes = Math.max(FULL_CONTENT_MIN_MINUTES, shortestMinutes);

  return Math.max(base, Math.ceil(((content + CARD_GAP_PX) * 60) / minutes));
}

/** The grid a card is drawn on, and the floor it may be lifted to. */
function cardFrame(
  view: CalendarView,
  card: CardMode,
): { scale: RowScale; floorPx: number } {
  // The day view has one column and density does not reach it.
  if (view === "day") return { scale: "day", floorPx: MIN_CARD_PX.day };
  if (card === "block") return { scale: "summary", floorPx: MIN_BLOCK_PX };
  if (card === "chip") return { scale: "week", floorPx: MIN_CHIP_PX };
  return { scale: "week", floorPx: MIN_CARD_PX.week };
}

/**
 * The height a card is actually drawn at, in px: its own, or its mode's floor,
 * whichever is larger — but never past where the next card below it begins,
 * less the gap that keeps the two apart.
 *
 * Every mode goes through here, `summary` included, so there is one cap and it
 * is always measured on the grid the card sits on. `minutesToNext` is measured
 * from *this* booking's start, which is exactly the room the card may grow
 * into. `own` loses the gap as well, because `cardBox` takes it off the
 * percentage height too — a min-height that kept it would put back the pixels
 * the height just gave up.
 */
export function cardHeightPx(
  durationMinutes: number,
  view: CalendarView = "week",
  minutesToNext: number | null = null,
  card: CardMode = "full",
  /** The hour this card is drawn on — `hourRowPx` — when it has grown. */
  hourPx?: number,
): number {
  const { scale, floorPx } = cardFrame(view, card);
  const own = slotHeightPx(durationMinutes, scale, hourPx) - CARD_GAP_PX;
  const ceiling =
    minutesToNext === null
      ? Infinity
      : slotHeightPx(minutesToNext, scale, hourPx) - CARD_GAP_PX;

  return Math.max(0, own, Math.min(floorPx, ceiling));
}

/**
 * The overview's floor, as CSS rather than as pixels.
 *
 * The overview's hour is sized by the stylesheet to fit the frame, so no
 * pixel figure computed here would be the one the browser draws — and a cap
 * measured on the wrong hour is exactly how a floor runs into the card below
 * it. A percentage of the grid is the one unit that stays true at every row
 * height: `MIN_BLOCK_PX` so a five-minute booking is still a mark, capped at
 * the next card's start less the gap, the same rule `cardHeightPx` applies in
 * pixels.
 */
export function blockMinHeight(
  minutesToNext: number | null,
  bounds: GridBounds,
): string {
  if (minutesToNext === null) return `${MIN_BLOCK_PX}px`;

  const gridSpan = Math.max(1, (bounds.endHour - bounds.startHour) * 60);
  const ceiling = (minutesToNext / gridSpan) * 100;
  return `max(0px, min(${MIN_BLOCK_PX}px, calc(${ceiling}% - ${CARD_GAP_PX}px)))`;
}

/** What `withoutCoveredCancellations` needs to know about an entry. */
export type StatusItem = CalendarItem & {
  kind: "appointment" | "block";
  status: string | null;
  /** Null for a block that closes the whole shop. */
  staffId: string | null;
};

/**
 * Cancelled bookings, only where nothing else holds their time.
 *
 * ---------------------------------------------------------------------------
 * **A cancellation earns a card while its slot is still open.** Then it is the
 * answer to "why is there a gap at eleven", and dimmed glass says so without
 * taking the slot back. The moment somebody else books that time, the
 * cancellation is history — it is in the agenda and on the client's record —
 * and drawing it beside its replacement would split the column into lanes, so
 * every live booking in that hour lost half its width to a booking that is not
 * happening.
 *
 * Held means held by *that chair*: a live booking, a finished one, a no-show or
 * a block for the same provider, or a block for the whole shop. Two
 * cancellations for the same slot keep only the first, for the same reason.
 * Per span, because that is what the grid draws.
 * ---------------------------------------------------------------------------
 */
export function withoutCoveredCancellations<T extends StatusItem>(
  items: readonly T[],
): T[] {
  const isCancelled = (item: T) =>
    item.kind === "appointment" && item.status === "cancelled";

  const clash = (a: T, b: T) =>
    a.dayIndex === b.dayIndex &&
    a.startMinutes < b.endMinutes &&
    b.startMinutes < a.endMinutes &&
    (a.staffId === null || b.staffId === null || a.staffId === b.staffId);

  const held = items.filter((item) => !isCancelled(item));
  const kept: T[] = [];

  const cancelled = items
    .filter(isCancelled)
    .sort(
      (a, b) =>
        a.dayIndex - b.dayIndex ||
        a.startMinutes - b.startMinutes ||
        a.endMinutes - b.endMinutes,
    );

  for (const item of cancelled) {
    if (held.some((other) => clash(item, other))) continue;
    if (kept.some((other) => clash(item, other))) continue;
    kept.push(item);
  }

  return items.filter((item) => !isCancelled(item) || kept.includes(item));
}

/**
 * Whether two placed items share any horizontal space.
 *
 * An item spans `[lane / lanes, (lane + 1) / lanes)` of its column. Compared by
 * cross-multiplying so a third of a column meeting a half is decided in
 * integers rather than in floating point.
 */
function sharesColumn(
  a: PlacedItem<CalendarItem>,
  b: PlacedItem<CalendarItem>,
): boolean {
  return (
    a.lane * b.lanes < (b.lane + 1) * a.lanes &&
    b.lane * a.lanes < (a.lane + 1) * b.lanes
  );
}

/**
 * How far it is from each item's start to the next card drawn below it.
 *
 * ---------------------------------------------------------------------------
 * **"Below it" means sharing its horizontal space, not sharing its lane
 * number.** This used to group by `lane`, which is only meaningful inside one
 * overlapping group: `assignLanes` starts counting again from zero for every
 * group, and a group of one is full width. So a short booking beside another in
 * lane 1 found nothing after it in lane 1, went uncapped, and its floor ran
 * into the full-width card that opened the next group — lane 0, and therefore
 * invisible to it. Reproduced in `calendar-layout.test.ts` at 6px of overlap.
 * Every day with an overlap has that shape: two providers busy at once, a
 * cancelled row beside its replacement, a break with a walk-in squeezed into
 * it.
 *
 * Null where nothing follows. Keyed by id, which is per *span* on this grid, so
 * a booking crossing midnight is two entries and each gets its own answer.
 * Quadratic in a day's bookings, like lane assignment, and memoised per day by
 * the caller for the same reason.
 * ---------------------------------------------------------------------------
 */
export function gapsToNext<T extends CalendarItem>(
  placed: readonly PlacedItem<T>[],
): Map<string, number | null> {
  const gaps = new Map<string, number | null>();

  for (const item of placed) {
    let nearest: number | null = null;

    for (const other of placed) {
      if (other === item || other.dayIndex !== item.dayIndex) continue;
      // Only what starts at or after this card can be under its floor. Anything
      // earlier that shares its space ended before it began — lanes are reused
      // only once their occupant has finished, and groups never overlap.
      if (other.startMinutes < item.startMinutes) continue;
      if (!sharesColumn(item, other)) continue;

      const gap = other.startMinutes - item.startMinutes;
      if (nearest === null || gap < nearest) nearest = gap;
    }

    gaps.set(item.id, nearest);
  }

  return gaps;
}

/**
 * How many of **client name / time / service** a card has room to show.
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
 * the card is drawn. **It is the largest number of lines that genuinely fit** —
 * `cardPxForLines` of the answer never exceeds the height — so the card clips
 * nothing. The one exception is the minimum of one line on a card too short for
 * even that, because an empty card is worse than a clipped name.
 *
 * Arithmetic on integers, in this module rather than in the component, for the
 * same reason everything else here is: it can be tested without rendering
 * anything or constructing a single Date.
 * ---------------------------------------------------------------------------
 */
export function lineBudget(
  /**
   * The card's **drawn** height, which is `cardHeightPx` and not the booking's
   * own — a fifteen-minute appointment lifted to the floor has genuinely got
   * room for its time, and budgeting from its duration would leave that room
   * empty.
   */
  heightPx: number,
  view: CalendarView = "week",
  card: Exclude<CardMode, "block"> = "full",
): number {
  const most = card === "chip" ? MAX_CHIP_LINES : MAX_CARD_LINES;

  for (let lines = most; lines > 1; lines--) {
    if (cardPxForLines(lines, view, card) <= heightPx) return lines;
  }
  return 1;
}

/** "09:00" from minutes past midnight. */
export function minutesToLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
