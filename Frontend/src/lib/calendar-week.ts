import { formatInTimeZone } from "date-fns-tz";

import { MINUTES_PER_DAY } from "./calendar-layout";

/**
 * UTC instants into the week grid's coordinates.
 *
 * ---------------------------------------------------------------------------
 * This is the only place in the calendar that knows what a timezone is. It runs
 * on the server, and everything downstream works in day indices and minutes —
 * the same division `analytics` uses when it extracts `AT TIME ZONE` in SQL,
 * and for the same reason: the browser's zone is not the shop's, and a calendar
 * that renders in the wrong one is wrong in a way that looks perfectly fine.
 *
 * It also splits an item across the days it covers, which is not a nicety. A
 * week's vacation is one `time_off` row; without splitting it would draw as a
 * single block on Sunday and the other six days would look bookable.
 * ---------------------------------------------------------------------------
 */

export type DaySpan = {
  /** Index into the `weekDays` array that was passed in. */
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

/** Minutes from local midnight, in the business timezone. */
function localMinutes(instant: Date, timezone: string): number {
  const [hours, minutes] = formatInTimeZone(instant, timezone, "HH:mm")
    .split(":")
    .map(Number);
  return hours * 60 + minutes;
}

/** "YYYY-MM-DD" in the business timezone. */
function localDate(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, "yyyy-MM-dd");
}

/**
 * The spans one interval occupies inside the displayed week.
 *
 * Empty when the interval falls entirely outside it — the caller renders
 * nothing rather than clamping something invisible onto the edge.
 *
 * An interval ending exactly at local midnight belongs to the day it started
 * on, not to the next one at 00:00. Half-open ranges, the same convention the
 * availability engine uses, so a block ending at midnight leaves the following
 * day genuinely clear.
 */
export function toDaySpans(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  weekDays: readonly string[],
): DaySpan[] {
  if (weekDays.length === 0) return [];
  if (endsAt.getTime() <= startsAt.getTime()) return [];

  const startDate = localDate(startsAt, timezone);
  const endDate = localDate(endsAt, timezone);
  const endMinutesRaw = localMinutes(endsAt, timezone);

  // Ending at exactly 00:00 closes the previous day rather than opening a new
  // one — otherwise every overnight block draws a zero-height sliver at the top
  // of the following column.
  const lastDate = endMinutesRaw === 0 ? previousDate(endDate) : endDate;

  const spans: DaySpan[] = [];

  for (const [dayIndex, day] of weekDays.entries()) {
    if (day < startDate || day > lastDate) continue;

    const startMinutes =
      day === startDate ? localMinutes(startsAt, timezone) : 0;
    const endMinutes =
      day === lastDate
        ? endMinutesRaw === 0
          ? MINUTES_PER_DAY
          : endMinutesRaw
        : MINUTES_PER_DAY;

    if (endMinutes > startMinutes) {
      spans.push({ dayIndex, startMinutes, endMinutes });
    }
  }

  return spans;
}

/** "2026-08-10" → "2026-08-09". String maths, so no timezone can intrude. */
function previousDate(date: string): string {
  const stamp = new Date(`${date}T00:00:00Z`);
  return new Date(stamp.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * The seven days of the week containing `date`, Sunday first.
 *
 * Sunday, because that is the Israeli week — the same choice the analytics
 * trend makes when it shifts Postgres' Monday-based `date_trunc`.
 */
export function weekOf(date: string): string[] {
  const stamp = new Date(`${date}T00:00:00Z`);
  const sunday = new Date(stamp.getTime() - stamp.getUTCDay() * 86_400_000);

  return Array.from({ length: 7 }, (_, index) =>
    new Date(sunday.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * `date` shifted by whole days, for the previous/next controls.
 *
 * Days rather than weeks because the same controls now step a **day** view by
 * one and a week view by seven. Arithmetic on the UTC midnight of a plain
 * calendar date, so it never crosses a DST boundary the way adding hours to a
 * local instant would.
 */
export function shiftDays(date: string, days: number): string {
  const stamp = new Date(`${date}T00:00:00Z`);
  return new Date(stamp.getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Kept for callers that think in weeks. */
export function shiftWeeks(date: string, weeks: number): string {
  return shiftDays(date, weeks * 7);
}
