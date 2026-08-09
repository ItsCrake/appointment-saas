import type { HeatCell, StatusCount } from "@/db/queries/analytics";

/**
 * Shaping for `/dashboard/analytics`. No IO, so the arithmetic an owner will
 * make decisions from is testable on its own.
 */

/* -------------------------------------------------------------------------- */
/* Range                                                                       */
/* -------------------------------------------------------------------------- */

export const ANALYTICS_RANGES = [30, 90, 365] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const DEFAULT_RANGE: AnalyticsRange = 90;

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  30: "30 יום",
  90: "3 חודשים",
  365: "שנה",
};

export function toRange(value: unknown): AnalyticsRange {
  const days = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(days)
    ? (days as AnalyticsRange)
    : DEFAULT_RANGE;
}

/**
 * Weekly buckets up to a quarter, monthly beyond it.
 *
 * 52 weekly bars on a phone is a smear rather than a trend; 12 monthly ones for
 * a 30-day range would be three bars, two of them partial.
 */
export function granularityFor(range: AnalyticsRange) {
  return range > 90 ? ("month" as const) : ("week" as const);
}

/**
 * The window, ending **now** rather than at midnight.
 *
 * Analytics that stop at the start of today would hide this morning's bookings
 * from an owner looking at their phone this afternoon, which is exactly when
 * they look.
 */
export function analyticsWindow(range: AnalyticsRange, now: Date) {
  return {
    from: new Date(now.getTime() - range * 86_400_000),
    to: now,
  };
}

/* -------------------------------------------------------------------------- */
/* Heatmap                                                                     */
/* -------------------------------------------------------------------------- */

/** 0 = Sunday, matching `EXTRACT(DOW)` and the rest of the app. */
export const WEEKDAY_LABELS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
export const WEEKDAY_FULL = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];

export type HeatGrid = {
  /** Only hours the shop actually books in — never a flat 00:00–23:00 axis. */
  hours: number[];
  /** One row per weekday, always all seven, so a dead day is visibly dead. */
  rows: { weekday: number; cells: number[] }[];
  /** Busiest single cell, for scaling the colour ramp. */
  max: number;
  total: number;
};

/**
 * The sparse `(weekday, hour, count)` rows into a dense grid.
 *
 * The hour axis is **derived from the data**, not fixed at 24 columns. A shop
 * open 09:00–18:00 gets nine columns that fill the width; a fixed axis would
 * spend two thirds of a phone screen on hours nobody has ever booked, and
 * squeeze the part that carries the answer.
 *
 * All seven weekdays are always present, because a row of zeroes is
 * information — it is the day the shop is shut, or the day nobody comes.
 */
export function buildHeatGrid(cells: HeatCell[]): HeatGrid {
  const withBookings = cells.filter((cell) => cell.bookings > 0);

  if (withBookings.length === 0) {
    return { hours: [], rows: [], max: 0, total: 0 };
  }

  const first = Math.min(...withBookings.map((cell) => cell.hour));
  const last = Math.max(...withBookings.map((cell) => cell.hour));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const lookup = new Map<string, number>();
  for (const cell of withBookings) {
    lookup.set(`${cell.weekday}:${cell.hour}`, cell.bookings);
  }

  const rows = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    cells: hours.map((hour) => lookup.get(`${weekday}:${hour}`) ?? 0),
  }));

  return {
    hours,
    rows,
    max: Math.max(...withBookings.map((cell) => cell.bookings)),
    total: withBookings.reduce((sum, cell) => sum + cell.bookings, 0),
  };
}

/** The busiest weekday overall, or null when there is nothing to rank. */
export function busiestWeekday(cells: HeatCell[]): number | null {
  const totals = new Map<number, number>();
  for (const cell of cells) {
    totals.set(cell.weekday, (totals.get(cell.weekday) ?? 0) + cell.bookings);
  }

  let best: number | null = null;
  let bestCount = 0;
  // Ascending, and strictly greater, so a tie resolves to the earlier day
  // rather than to whichever row the database happened to return first.
  for (const weekday of [...totals.keys()].sort((a, b) => a - b)) {
    const count = totals.get(weekday) ?? 0;
    if (count > bestCount) {
      best = weekday;
      bestCount = count;
    }
  }

  return bestCount > 0 ? best : null;
}

/** The busiest hour of the day overall, or null. Same tie rule. */
export function busiestHour(cells: HeatCell[]): number | null {
  const totals = new Map<number, number>();
  for (const cell of cells) {
    totals.set(cell.hour, (totals.get(cell.hour) ?? 0) + cell.bookings);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const hour of [...totals.keys()].sort((a, b) => a - b)) {
    const count = totals.get(hour) ?? 0;
    if (count > bestCount) {
      best = hour;
      bestCount = count;
    }
  }

  return bestCount > 0 ? best : null;
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export type StatusSummary = {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Confirmed plus anything still awaiting an answer. */
  upcoming: number;
  /** Percentages of `total`, rounded, never NaN. */
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
};

/** Integer percentage, and 0 rather than NaN when there is no denominator. */
export function rate(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function summariseStatuses(counts: StatusCount[]): StatusSummary {
  const of = (status: string) =>
    counts.find((row) => row.status === status)?.bookings ?? 0;

  const total = counts.reduce((sum, row) => sum + row.bookings, 0);
  const completed = of("completed");
  const cancelled = of("cancelled");
  const noShow = of("no_show");

  // Everything that has not resolved yet, including the two deposit statuses,
  // so a status added later cannot silently vanish from the total.
  const upcoming = total - completed - cancelled - noShow;

  return {
    total,
    completed,
    cancelled,
    noShow,
    upcoming,
    completionRate: rate(completed, total),
    cancellationRate: rate(cancelled, total),
    noShowRate: rate(noShow, total),
  };
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

/** "12.8" for a week, "אוג׳ 26" for a month. */
export function periodLabel(
  period: string,
  granularity: "week" | "month",
): string {
  const [year, month, day] = period.split("-");
  if (granularity === "week") return `${Number(day)}.${Number(month)}`;

  const MONTHS = [
    "ינו׳",
    "פבר׳",
    "מרץ",
    "אפר׳",
    "מאי",
    "יוני",
    "יולי",
    "אוג׳",
    "ספט׳",
    "אוק׳",
    "נוב׳",
    "דצמ׳",
  ];
  return `${MONTHS[Number(month) - 1]} ${year.slice(2)}`;
}
