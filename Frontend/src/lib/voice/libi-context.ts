import { formatInTimeZone } from "date-fns-tz";

import { shiftDays } from "@/lib/calendar-week";
import { todayInTimezone, weekdayLabel } from "@/lib/format";

import type { RosterRow } from "./libi-tools";

/**
 * What ליבי knows before she is asked anything.
 *
 * ---------------------------------------------------------------------------
 * **The clock is the half that was simply missing.** A language model has no
 * idea what day it is, so every question containing "היום", "מחר" or "ביום
 * חמישי" was being answered by a model guessing at a date — or, more often,
 * picking a tool and hoping the server would sort it out. Stating the shop's
 * own date and time removes a whole class of wrong answer and costs one line.
 *
 * **The diary is the half that changes the bargain, and it is worth being
 * honest about.** Until now the model could not state a fact: it chose a tool,
 * and the tool produced a sentence from `libi-speech`, which is pure and
 * tested. That is why no summary has ever drifted from the data. Putting the
 * roster in the prompt lets the model answer things no tool covers — "what have
 * I got on Thursday?", "what is the 15:00 for?" — and in exchange it can now
 * say something no test wrote.
 *
 * Three things narrow that: the tools stay authoritative for the questions they
 * cover and the prompt says so; the model runs at `temperature: 0`; and the
 * context is a literal transcription of rows, so "answer only from the list" is
 * an instruction it can actually follow rather than a hope.
 *
 * **Cancelled and no-show rows never appear.** `upcomingRoster` filters to the
 * blocking statuses, and that is deliberate rather than incidental: a cancelled
 * slot read back as booked sends an owner to meet somebody who is not coming,
 * which is the single most expensive thing this assistant could get wrong.
 * ---------------------------------------------------------------------------
 */

/**
 * **The diary is detailed for two days and summarised for the rest.**
 *
 * It used to be the first 25 rows of the week, introduced as "the complete
 * list — there are no other appointments". On a full week that was today,
 * tomorrow and a slice of the day after; asked about Monday, the model read
 * the list, believed it, and said there was nothing — and asked to cancel a
 * client booked on Sunday, it answered "I don't see him" without calling the
 * tool. Both were verified against `demo-barber`'s load-tested fortnight.
 *
 * Today and tomorrow are what most questions are about, so they are listed in
 * full (up to {@link DETAIL_LIMIT}); every other day is one line of count and
 * hours, with no names. The model is told exactly which of the two it is
 * looking at, and told plainly when even that was cut short.
 */
export const DETAIL_DAYS = 2;
export const DETAIL_LIMIT = 40;

/** Times in the shop's zone; the model must never do timezone arithmetic. */
function line(row: RosterRow, timezone: string): string {
  const day = formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd");
  const time = formatInTimeZone(row.startsAt, timezone, "HH:mm");
  return `- ${day} (${weekdayLabel(day)}) ${time} · ${row.clientName} · ${row.serviceName} · ${row.status}`;
}

/** One day as a count and its hours, for the days not listed in full. */
function summaryLine(
  day: string,
  rows: readonly RosterRow[],
  timezone: string,
) {
  const first = formatInTimeZone(rows[0].startsAt, timezone, "HH:mm");
  const last = formatInTimeZone(
    rows[rows.length - 1].startsAt,
    timezone,
    "HH:mm",
  );
  const count = rows.length === 1 ? "תור אחד" : `${rows.length} תורים`;
  const hours =
    rows.length === 1 ? `ב-${first}` : `הראשון ב-${first}, האחרון ב-${last}`;
  return `- ${day} (${weekdayLabel(day)}): ${count}, ${hours}`;
}

/**
 * The system prompt's context block.
 *
 * Kept pure and separate from the prompt's *instructions* so it can be tested
 * against real rows: the instructions are prose and change with taste, while
 * this is data and has to be exactly right.
 *
 * `fetchLimit` is the cap the roster was read with; a roster that reached it
 * may be missing rows, and the block says so instead of claiming the week.
 */
export function buildPromptContext(
  now: Date,
  timezone: string,
  roster: readonly RosterRow[],
  { fetchLimit }: { fetchLimit?: number } = {},
): string {
  const today = todayInTimezone(timezone, now);
  const clock = formatInTimeZone(now, timezone, "HH:mm");

  const header = [
    `התאריך היום: ${today} (יום ${weekdayLabel(today)}).`,
    `השעה עכשיו: ${clock} (${timezone}).`,
  ].join("\n");

  if (roster.length === 0) {
    // Said explicitly rather than left as an empty list. "No appointments" is
    // an answer; an absent section invites the model to fill the gap.
    return `${header}\nאין תורים ביומן בשבוע הקרוב.`;
  }

  const byDay = new Map<string, RosterRow[]>();
  for (const row of roster) {
    const day = formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd");
    const rows = byDay.get(day) ?? [];
    rows.push(row);
    byDay.set(day, rows);
  }

  // Today and tomorrow as shop-local calendar dates — calendar arithmetic on
  // the date string, so a DST night cannot shift which day is "tomorrow".
  const detailDays = Array.from({ length: DETAIL_DAYS }, (_, offset) =>
    shiftDays(today, offset),
  );

  const detailed = roster.filter((row) =>
    detailDays.includes(formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd")),
  );
  const shown = detailed.slice(0, DETAIL_LIMIT);
  const later = [...byDay.entries()]
    .filter(([day]) => !detailDays.includes(day))
    .sort(([a], [b]) => a.localeCompare(b));

  const truncated = fetchLimit !== undefined && roster.length >= fetchLimit;

  const lines = [
    header,
    `תורים היום: ${(byDay.get(today) ?? []).length}.`,
    shown.length < detailed.length
      ? `היום ומחר — מוצגים ${shown.length} מתוך ${detailed.length} תורים:`
      : "היום ומחר — כל התורים:",
    ...(shown.length > 0
      ? shown.map((row) => line(row, timezone))
      : ["- אין תורים היום ומחר."]),
  ];

  if (later.length > 0) {
    lines.push(
      "שאר השבוע — סיכום בלבד, בלי שמות:",
      ...later.map(([day, rows]) => summaryLine(day, rows, timezone)),
    );
  }

  lines.push(
    truncated
      ? "היומן עמוס: ייתכן שיש תורים שאינם מופיעים כאן."
      : "ימים שאינם מופיעים — אין בהם תורים.",
  );

  return lines.join("\n");
}
