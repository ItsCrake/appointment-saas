/**
 * How long ליבי's ring stays on a booking she was asked to show.
 *
 * Long enough to find it after the page has scrolled and settled, short enough
 * that it is gone before the owner has moved on to using the calendar for
 * something else. Whichever comes first — this, or their next click.
 */
export const FOCUS_RING_MS = 8000;
/**
 * How much of the week the grid tries to show at once.
 *
 * ---------------------------------------------------------------------------
 * **The week grid is 912px wide before anything is on it.** `gridMinWidthPx`
 * reserves `MIN_LANE_PX` (144) per lane so a card is never an ellipsis, and six
 * days of one lane each is `48 + 6 × 144`. On the 390px phone this product is
 * actually opened on, that is two and a half screens of sideways travel to see
 * a week — and the owner reaching for the week view is the one asking "how full
 * am I", which is a question about the shape of all six days together.
 *
 * So the floor becomes a **choice** rather than a constant. It is the owner's
 * to make, because the trade it makes is theirs: wide enough to read every card
 * without opening it, or narrow enough to see the week whole. Neither answer is
 * right for both a barber checking a gap between clients and one deciding
 * whether to take Thursday off.
 *
 * **This is a preference, not a viewport.** It is offered at every width rather
 * than only on a phone, for two reasons. A control that disappears above a
 * breakpoint strands whatever it last set — the preference persists, the way
 * back does not. And the calendar deliberately measures nothing at runtime (see
 * the note on `WeekCalendar`); deriving the mode from `matchMedia` would put a
 * resize listener into the one component built to avoid them.
 *
 * **Each mode also sets its own vertical scale, and says what every card
 * shows.** `standard` grows the hour until the shortest booking holds all three
 * lines; `compact` until it holds a first name and a start time; `summary` fits
 * the whole day into the frame and puts only a start time on each card. The
 * arithmetic for the first two is `hourRowPx` in `calendar-layout`; the third
 * is `.cal-summary-row` in the stylesheet, because "the frame" is a viewport
 * height and this grid measures nothing at runtime.
 * ---------------------------------------------------------------------------
 */

export const CALENDAR_DENSITIES = ["standard", "compact", "summary"] as const;

export type CalendarDensity = (typeof CALENDAR_DENSITIES)[number];

/**
 * What a new owner gets, and what the server renders before the browser has
 * said otherwise — see `readStoredDensity` for why that matters.
 */
export const DEFAULT_DENSITY: CalendarDensity = "standard";

/** Where the choice is kept. Namespaced like `bazman.cookie-consent`. */
export const DENSITY_STORAGE_KEY = "bazman.calendar-density";

/**
 * The hour row `summary` uses instead of a pixel height.
 *
 * ---------------------------------------------------------------------------
 * **Sized to the frame, so the whole day is one screen.** It was a fixed
 * `h-12`, which fit a laptop and not a phone: twelve 48px hours under the day
 * header came to 621px inside a 574px frame, and the overview scrolled. The
 * rule in `globals.css` divides the frame's own height — the same `68dvh` /
 * `76dvh` the scroll container is capped at, less the fixed day header — by the
 * number of rows, which the grid passes in as `--cal-rows`.
 *
 * A floor of 2.25rem an hour stops a shop open from dawn to midnight becoming
 * slivers; past that the overview scrolls, which is the honest answer.
 * ---------------------------------------------------------------------------
 */
export const SUMMARY_HOUR_ROW = "cal-summary-row";

/**
 * The pinned day header's height, which `.cal-summary-row` subtracts.
 *
 * Fixed in every mode, not only the overview, so the header never changes size
 * as the owner switches between them.
 */
export const DAY_HEADER_ROW = "h-12";

export type DensitySpec = {
  /**
   * The narrowest one lane may be drawn, in px — what `gridMinWidthPx`
   * multiplies out.
   */
  lanePx: number;
  /**
   * What a card puts inside itself.
   *
   * - `full` — name, time span and service, on every booking: the hour grows
   *   until the shortest one holds all three.
   * - `chip` — the client's **first** name and the start time, on every
   *   booking. A surname in a 42px column is an ellipsis; the first name is the
   *   part an owner scans for, and the hour grows until both lines fit.
   * - `block` — the start time and nothing else, as a small badge. The card is
   *   a mark of colour and the detail lives one tap away, which is the point of
   *   the mode; the time is what the mark's position only approximates.
   */
  card: "full" | "chip" | "block";
  /** Hebrew label for the switcher. */
  label: string;
  /** What the mode is for, for the control's accessible name. */
  hint: string;
};

export const DENSITY: Record<CalendarDensity, DensitySpec> = {
  /**
   * The default, and the widest. Its lane is unchanged — the view an owner
   * already knows keeps its columns — and what it gained is height: every
   * booking now shows all three lines, because the hour grows to fit the
   * shortest one rather than the floor being capped by its neighbour.
   */
  standard: {
    lanePx: 144,
    card: "full",
    label: "רגיל",
    hint: "תצוגה רגילה — כל הפרטים על הכרטיס",
  },
  /**
   * 42px a lane, measured against the **content box** rather than the viewport:
   * a 390px phone leaves 356px inside the dashboard's own padding, and sizing
   * to 390 is how a mode that "fits" arrives 28px too wide. `48 + 7 × 42 = 342`
   * clears it with room, and seven days rather than six because a shop that
   * opens on Saturday must not be the single case that overflows.
   *
   * A shop with two providers busy at the same hour is 636px and still scrolls,
   * and that is not a number worth chasing — two overlapping bookings genuinely
   * need two columns, and the honest fix for that owner is `summary`.
   */
  compact: {
    lanePx: 42,
    card: "chip",
    label: "צפוף",
    hint: "תצוגה צפופה — כל השבוע ברוחב המסך, שם פרטי ושעה",
  },
  /**
   * 20px a lane, so even a **seven**-day week with two providers overlapping is
   * `48 + 7 × 2 × 20 = 328` and still fits the 356px content box. That is the
   * case `compact` cannot reach, and the reason this mode drops text rather
   * than merely shrinking it.
   *
   * Three providers overlapping across seven days is 468px and scrolls. Chasing
   * that would mean a 13px lane, which is a colour and no shape — at some point
   * the honest answer is that the week really is that busy.
   *
   * The minimum is a floor rather than a width: the columns are
   * `minmax(0, 1fr)` and stretch to fill whatever is left, so a quiet week in
   * this mode simply uses the whole screen.
   *
   * Its floor lives with every other floor, in `calendar-layout` as
   * `MIN_BLOCK_PX`, where the cap that stops it reaching the next card is
   * measured on this mode's own 48px hour.
   */
  summary: {
    lanePx: 20,
    card: "block",
    label: "סיכום",
    hint: "תצוגת סיכום — כל השבוע במסך אחד, שעת התחלה בלבד",
  },
};

/**
 * Coerces anything to a legal density.
 *
 * Total, like every other value this product reads back from somewhere it does
 * not control. `localStorage` is editable by hand, survives a release that
 * renames a mode, and is shared with whatever else the browser has stored under
 * this origin — so an unknown value degrades to the default rather than
 * rendering a calendar with no lane width.
 */
export function toDensity(value: unknown): CalendarDensity {
  return CALENDAR_DENSITIES.includes(value as CalendarDensity)
    ? (value as CalendarDensity)
    : DEFAULT_DENSITY;
}

/**
 * The stored choice, or the default.
 *
 * Returns the default rather than throwing when storage is unavailable —
 * private mode, or a browser configured to refuse it. The same call that the
 * cookie banner wraps in a `try`, for the same reason: a preference is not
 * worth a blank page.
 */
export function readStoredDensity(): CalendarDensity {
  try {
    return toDensity(window.localStorage.getItem(DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_DENSITY;
  }
}

/** Persists the choice, silently doing nothing where storage is refused. */
export function storeDensity(density: CalendarDensity): void {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // The mode still applies for this session; it just will not be remembered.
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The choice as an **external store**, which is what `useSyncExternalStore`
 * wants and what keeps this out of an effect.
 *
 * ---------------------------------------------------------------------------
 * The obvious shape is `useState(DEFAULT)` plus a mount effect that reads
 * storage — and it works, but it sets state synchronously inside an effect,
 * which is a cascading render and which the lint rules here refuse. The reason
 * it refuses is the real one: the component renders once with an answer nobody
 * asked for, then again with the right one.
 *
 * `localStorage` *is* an external store, so it is modelled as one. React reads
 * {@link densityServerSnapshot} on the server and through hydration — so the
 * markup matches — and swaps to {@link densitySnapshot} immediately after,
 * without a render pass that exists only to correct the previous one.
 *
 * The snapshot is cached because `getSnapshot` is called on every render and
 * must not do work per call; the cache is seeded lazily so nothing touches
 * `window` until a browser is actually there.
 * ---------------------------------------------------------------------------
 */
let cachedDensity: CalendarDensity | null = null;
const densityListeners = new Set<() => void>();

export function subscribeDensity(onChange: () => void): () => void {
  densityListeners.add(onChange);
  return () => {
    densityListeners.delete(onChange);
  };
}

export function densitySnapshot(): CalendarDensity {
  cachedDensity ??= readStoredDensity();
  return cachedDensity;
}

/**
 * What the server renders, and what hydration matches against.
 *
 * Always the default: the server has no way to know the preference, and
 * guessing would be a hydration mismatch — markup describing one grid width
 * against a client about to build another.
 */
export function densityServerSnapshot(): CalendarDensity {
  return DEFAULT_DENSITY;
}

/** Sets the mode for every subscriber, and remembers it. */
export function chooseDensity(next: CalendarDensity): void {
  if (cachedDensity === next) return;
  cachedDensity = next;
  storeDensity(next);
  for (const listener of densityListeners) listener();
}
