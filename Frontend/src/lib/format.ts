import { formatInTimeZone } from "date-fns-tz";

import { DEFAULT_LOCALE, type Locale } from "@/lib/showcase";

/**
 * A price, in the currency the tenant charges in.
 *
 * `narrowSymbol` is not cosmetic. Asked for ILS, the default `he-IL` output is
 * "‏70 ‏₪" — two RIGHT-TO-LEFT MARKs wrapped around the
 * number. Inside the Hebrew page that is correct and invisible. Inside the
 * Spanish showcase, whose booking column is `ltr`, those marks flip the run
 * they sit in and "₪70 · 30 min" renders as "30 · ₪70 min"
 * — the duration and its unit torn apart around the price. Every other
 * locale returns the bare symbol, so the marks travel with `he-IL` alone and
 * asking for the narrow symbol is what removes them.
 */
export function formatPrice(cents: number, currency = "ILS", locale = "he-IL") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * "45 דק׳", "שעה", "שעה ו-30 דק׳".
 *
 * The locale argument is optional and defaults to Hebrew, which is what every
 * dashboard call site wants and is why they were left untouched. Only the
 * public booking page, which can be addressed in another language, passes it.
 */
export function formatDuration(minutes: number, locale: Locale = DEFAULT_LOCALE) {
  if (locale === "es") {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const r = minutes % 60;
    const hLabel = h === 1 ? "1 hora" : `${h} horas`;
    return r === 0 ? hLabel : `${hLabel} y ${r} min`;
  }
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

/**
 * Weekday names by locale, indexed the way `getUTCDay()` counts — Sunday first.
 *
 * Written out rather than taken from `Intl`, because these appear beside the
 * dictionary's own strings and have to agree with them in register and casing.
 * `Intl` gives Spanish weekdays lowercase, which is correct Spanish but reads
 * wrong in a day-chip beside a capitalised "Hoy".
 */
const WEEKDAYS: Record<Locale, string[]> = {
  he: HEBREW_WEEKDAYS,
  es: [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ],
};

/** Short weekday for a plain "YYYY-MM-DD" date, e.g. "יום ג׳" → "שלישי". */
export function weekdayLabel(date: string, locale: Locale = DEFAULT_LOCALE) {
  return WEEKDAYS[locale][new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function dayOfMonth(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

/** BCP-47 tags for `Intl`, which does not take this file's short locale. */
export const INTL_LOCALES: Record<Locale, string> = {
  he: "he-IL",
  es: "es-ES",
};

export function monthLabel(date: string, locale = INTL_LOCALES.he) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Full human date for the confirmation screen, in the business timezone. */
export function formatFullDateTime(
  iso: string,
  timezone: string,
  locale: Locale = DEFAULT_LOCALE,
) {
  const date = new Date(iso);
  const weekday =
    WEEKDAYS[locale][Number(formatInTimeZone(date, timezone, "i")) % 7];
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
