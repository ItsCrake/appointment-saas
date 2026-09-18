import { formatInTimeZone } from "date-fns-tz";

import { todayInTimezone, weekdayLabel } from "@/lib/format";

/**
 * What the assistant actually says.
 *
 * ---------------------------------------------------------------------------
 * **Pure, and separated from the route on purpose.** Everything hard about this
 * feature is in here — Hebrew number agreement, which day a timestamp falls on
 * in the shop's timezone rather than the server's, and the four or five ways a
 * calendar can be empty — and none of it needs a database to test. The route
 * fetches rows; this decides the sentence.
 *
 * **Written to be heard, not read.** A screen can afford "0 תורים"; a voice
 * cannot, and every string here is checked by reading it aloud. That is why
 * counts are spelled the way the rest of the product spells them — "תור אחד"
 * for one, a numeral from two up, matching `agenda-view` and `pending-requests`
 * so the app and the assistant do not describe the same day differently.
 *
 * **Time is the shop's, never the server's.** A booking at 14:00 in Jerusalem
 * is 11:00Z, and a summary generated on a machine in another zone would name
 * the wrong hour with total confidence. Every timestamp here goes through the
 * business timezone.
 * ---------------------------------------------------------------------------
 */
export type SpokenAppointment = {
  startsAt: Date;
  clientName: string;
  serviceName: string;
};

/** "14:00" in the shop's own zone. */
export function spokenTime(at: Date, timezone: string): string {
  return formatInTimeZone(at, timezone, "HH:mm");
}

/**
 * "היום" / "מחר" / "ביום שלישי" — how a person refers to a day out loud.
 *
 * A weekday name for anything past tomorrow, and nothing at all for today: "the
 * next appointment **today** at two" is how it would be said, and inserting the
 * word makes the sentence longer without making it clearer. Past a week the
 * weekday alone is ambiguous, so the date is added — "ביום שלישי, 12 בספטמבר"
 * is the difference between this Tuesday and one three weeks out.
 */
export function spokenDay(at: Date, now: Date, timezone: string): string {
  const day = formatInTimeZone(at, timezone, "yyyy-MM-dd");
  const today = todayInTimezone(timezone, now);

  if (day === today) return "";

  const tomorrow = todayInTimezone(
    timezone,
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );
  if (day === tomorrow) return "מחר";

  const withinWeek =
    at.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;

  return withinWeek
    ? `ביום ${weekdayLabel(day)}`
    : `ביום ${weekdayLabel(day)}, ${formatInTimeZone(at, timezone, "d")} ב${MONTHS[Number(formatInTimeZone(at, timezone, "M")) - 1]}`;
}

/** Spoken month names. `toLocaleDateString` would do, but not in a pure test. */
const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

/**
 * "תור אחד" / "6 תורים".
 *
 * Hebrew agrees the numeral with the noun's gender and drops it entirely at
 * one, so "1 תורים" and "1 תור" are both wrong in a way a listener notices
 * immediately. Two upward takes the numeral, which is what the rest of the
 * product already does and what Siri reads back correctly.
 */
export function spokenCount(count: number): string {
  return count === 1 ? "תור אחד" : `${count} תורים`;
}

/** Joins the pieces of a sentence, dropping the empty ones. */
function sentence(...parts: string[]): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * How many options a question reads out before it stops listing them.
 *
 * Four names is a question somebody can hold in their head while answering;
 * a shop's whole price list is a menu read aloud. Past four she offers the
 * first few "למשל" and the owner says what they want.
 */
export const MAX_SPOKEN_CHOICES = 4;

/**
 * "תספורת גבר, זקן או צבע" — the options of a question, as said.
 *
 * Hebrew puts "או" before the last one only. Past {@link MAX_SPOKEN_CHOICES}
 * the list is cut and introduced as examples, so it is still true.
 */
export function spokenChoice(options: readonly string[]): string {
  const shown = options.slice(0, MAX_SPOKEN_CHOICES);
  const list =
    shown.length <= 1
      ? (shown[0] ?? "")
      : `${shown.slice(0, -1).join(", ")} או ${shown[shown.length - 1]}`;
  return options.length > MAX_SPOKEN_CHOICES ? `למשל ${list}` : list;
}

/**
 * "חצי שעה", "שעה", "שעה וחצי", "45 דקות" — a length as a person says it.
 *
 * A swap is refused by how long something takes, and "90 דקות" is how a form
 * says it rather than how a barber does. Quarter and half hours get their own
 * words; anything else is left in minutes for `libi-hebrew` to spell.
 */
export function spokenDuration(minutes: number): string {
  if (minutes < 60) return minutes === 30 ? "חצי שעה" : `${minutes} דקות`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const whole = hours === 1 ? "שעה" : hours === 2 ? "שעתיים" : `${hours} שעות`;

  if (rest === 0) return whole;
  if (rest === 15) return `${whole} ורבע`;
  if (rest === 30) return `${whole} וחצי`;
  return `${whole} ו-${rest} דקות`;
}

/**
 * The destination of a move, with the "to" Hebrew fuses onto it.
 *
 * "ל" joins the word it governs, and the phrases here start three ways: a
 * clock ("ל-15:00"), a day word ("למחר", "להיום"), and "ביום שלישי", where
 * the "ב" gives way — "ליום שלישי", never "לביום שלישי", which is what gluing
 * the letter on produced.
 */
export function toward(at: string): string {
  if (/^\d/.test(at)) return `ל-${at}`;
  if (at.startsWith("ביום ")) return `ל${at.slice(1)}`;
  return `ל${at}`;
}

/** "היום", "מחר", "ביום שלישי" for a shop-local date — the week's own days. */
function weekDayPhrase(day: string, today: string): string {
  if (day === today) return "היום";
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return day === tomorrow ? "מחר" : `ביום ${weekdayLabel(day)}`;
}

/**
 * `get_week_summary` — what is left of this week, or all of next.
 *
 * ---------------------------------------------------------------------------
 * **The same shape as every other count she says.** One or two bookings are
 * named with their day and time, since that is still an answer somebody can
 * hold; more than two are a count, how many days they fall on, and the busiest
 * day — the question behind "מה יש לי בשבוע הבא?" is how full it is, not a
 * list, which the prompt already forbids reading out.
 *
 * **Days are weekday names, not dates.** Every day in either week is inside
 * the next fortnight, so "ביום שלישי" is unambiguous once "בשבוע הבא" has been
 * said, and a date on top would be four syllables of nothing.
 *
 * Ties for busiest go to the earlier day, so the sentence is the same every
 * time it is asked.
 * ---------------------------------------------------------------------------
 */
export function spokenWeek(
  which: "this" | "next",
  rows: readonly SpokenAppointment[],
  now: Date,
  timezone: string,
): string {
  if (rows.length === 0) {
    return which === "next"
      ? "אין לך תורים בשבוע הבא."
      : "לא נשארו לך תורים השבוע.";
  }

  const label = which === "next" ? "בשבוע הבא יש לך" : "השבוע נשארו לך";
  const today = todayInTimezone(timezone, now);
  const dayOf = (row: SpokenAppointment) =>
    formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd");
  const at = (row: SpokenAppointment) =>
    `${weekDayPhrase(dayOf(row), today)} ב-${spokenTime(row.startsAt, timezone)}`;

  if (rows.length === 1) {
    return `${label} תור אחד: ${rows[0].clientName} ${at(rows[0])}.`;
  }
  if (rows.length === 2) {
    return `${label} ${spokenCount(2)}: ${rows[0].clientName} ${at(rows[0])}, ו${rows[1].clientName} ${at(rows[1])}.`;
  }

  const perDay = new Map<string, number>();
  for (const row of rows) {
    perDay.set(dayOf(row), (perDay.get(dayOf(row)) ?? 0) + 1);
  }

  if (perDay.size === 1) {
    return `${label} ${spokenCount(rows.length)}, כולם ${weekDayPhrase(dayOf(rows[0]), today)}.`;
  }

  const [busiest, most] = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((best, entry) => (entry[1] > best[1] ? entry : best));

  return `${label} ${spokenCount(rows.length)} ב-${perDay.size} ימים. הכי עמוס ${weekDayPhrase(busiest, today)}, עם ${spokenCount(most)}.`;
}

/**
 * `action=next` — the very next appointment, whenever it is.
 *
 * The brief's fallback line says "today", and the query behind it is
 * deliberately **not** limited to today: an owner asking at 19:00 whose next
 * client is at 09:00 tomorrow is better served by hearing that than by "you
 * have nothing else today", which is true and useless. Today's answer omits the
 * day, anything later names it, and only a genuinely empty calendar falls back
 * to the line the brief asked for.
 */
export function spokenNext(
  next: SpokenAppointment | null,
  now: Date,
  timezone: string,
): string {
  if (!next) return "אין לך תורים נוספים להיום.";

  const day = spokenDay(next.startsAt, now, timezone);
  return sentence(
    "התור הבא שלך",
    day,
    `בשעה ${spokenTime(next.startsAt, timezone)}`,
    `עם ${next.clientName}`,
    `(${next.serviceName}).`,
  );
}

/**
 * `action=today` — how full the day is, and what is next in it.
 *
 * Three states, because "6 appointments" means something different at 08:00
 * than at 21:00. A day with bookings that have all already happened is the one
 * the brief lists under "past business hours", and saying only "you have six
 * today" to an owner locking up is a small lie of tense.
 */
export function spokenToday(
  total: number,
  nextToday: SpokenAppointment | null,
  timezone: string,
): string {
  if (total === 0) return "אין לך תורים היום.";

  const summary = `יש לך היום ${spokenCount(total)} ביומן.`;

  if (!nextToday) return `${summary} כולם כבר מאחוריך.`;

  return `${summary} התור הקרוב בשעה ${spokenTime(nextToday.startsAt, timezone)}.`;
}

/**
 * `action=search` — upcoming bookings for one client.
 *
 * Names the nearest one and says how many others there are rather than reading
 * a list: a spoken list of five times is not something anyone retains, and the
 * follow-up question ("and when is the one after?") is better served by the
 * app. The searched name is echoed back on a miss so the owner can hear how it
 * was understood — the most common failure here is dictation, not data.
 */
export function spokenSearch(
  query: string,
  matches: SpokenAppointment[],
  now: Date,
  timezone: string,
): string {
  if (matches.length === 0) return `לא מצאתי תורים על השם ${query}.`;

  const [first] = matches;
  const when = sentence(
    spokenDay(first.startsAt, now, timezone),
    `בשעה ${spokenTime(first.startsAt, timezone)}`,
  );

  if (matches.length === 1) {
    return `מצאתי תור אחד ל${first.clientName}, ${when} (${first.serviceName}).`;
  }

  // Several people can answer to one spoken name — "דני" is דני כהן and דני
  // לוי — and naming only the first would pass them off as one client.
  if (matches.some((row) => row.clientName !== first.clientName)) {
    return `מצאתי ${matches.length} תורים על השם ${query}. הקרוב ל${first.clientName}, ${when} (${first.serviceName}).`;
  }

  return `מצאתי ${matches.length} תורים ל${first.clientName}. הקרוב ${when} (${first.serviceName}).`;
}
