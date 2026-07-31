import { formatInTimeZone } from "date-fns-tz";

export function formatPrice(cents: number, currency = "ILS", locale = "he-IL") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursLabel = hours === 1 ? "שעה" : `${hours} שעות`;
  return rest === 0 ? hoursLabel : `${hoursLabel} ו-${rest} דק׳`;
}

const HEBREW_WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];

/** Short weekday for a plain "YYYY-MM-DD" date, e.g. "יום ג׳" → "שלישי". */
export function weekdayLabel(date: string) {
  return HEBREW_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function dayOfMonth(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

export function monthLabel(date: string, locale = "he-IL") {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Full human date for the confirmation screen, in the business timezone. */
export function formatFullDateTime(iso: string, timezone: string) {
  const date = new Date(iso);
  const weekday =
    HEBREW_WEEKDAYS[Number(formatInTimeZone(date, timezone, "i")) % 7];
  return {
    time: formatInTimeZone(date, timezone, "HH:mm"),
    date: formatInTimeZone(date, timezone, "dd/MM/yyyy"),
    weekday,
  };
}

/** Local "YYYY-MM-DD" for a business timezone, used to seed the date picker. */
export function todayInTimezone(timezone: string, now = new Date()) {
  return formatInTimeZone(now, timezone, "yyyy-MM-dd");
}

/** N consecutive calendar dates starting at `from` (a "YYYY-MM-DD" string). */
export function dateRange(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}
