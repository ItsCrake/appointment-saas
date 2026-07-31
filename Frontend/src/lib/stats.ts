import { fromZonedTime } from "date-fns-tz";

import { todayInTimezone } from "./format";

const DAY_MS = 86_400_000;

export type StatsWindows = {
  /** Business-local "today", as UTC instants. */
  todayStart: Date;
  todayEnd: Date;
  /** Sunday-start week containing today — the Israeli working week. */
  weekStart: Date;
  weekEnd: Date;
  /** Start of the trailing window the rates are measured over. */
  ratesFrom: Date;
  /** Rates only count appointments that have already happened. */
  now: Date;
};

/** Day-of-week (0 = Sunday) for a plain "YYYY-MM-DD" calendar date. */
function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function shiftDate(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Pure boundary maths. Everything is computed from the business-local calendar
 * date and then resolved to UTC instants, so "today" means the owner's today
 * rather than the server's — and the DST-affected days are still exactly one
 * local day long.
 */
export function getStatsWindows(
  timezone: string,
  now: Date = new Date(),
  { ratesWindowDays = 30 }: { ratesWindowDays?: number } = {},
): StatsWindows {
  const today = todayInTimezone(timezone, now);
  const weekStartDate = shiftDate(today, -weekdayOf(today));

  const toUtc = (date: string) => fromZonedTime(`${date}T00:00:00`, timezone);

  return {
    todayStart: toUtc(today),
    todayEnd: toUtc(shiftDate(today, 1)),
    weekStart: toUtc(weekStartDate),
    weekEnd: toUtc(shiftDate(weekStartDate, 7)),
    ratesFrom: new Date(now.getTime() - ratesWindowDays * DAY_MS),
    now,
  };
}

/** Whole-percent rate, guarding the empty denominator. */
export function toPercent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
