import { formatInTimeZone } from "date-fns-tz";

import { shiftDays, weekOf } from "@/lib/calendar-week";
import { todayInTimezone, weekdayLabel } from "@/lib/format";

import type { DraftAction, RosterRow } from "./libi-tools";

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

/**
 * This week, next week, and the last day the diary in the prompt covers.
 *
 * ---------------------------------------------------------------------------
 * **The window used to be seven days, and "next week" fell off the end of
 * it.** Asked on a Thursday what was on next Tuesday — nine days out — the
 * model read a diary that stopped on Wednesday and a line saying days it did
 * not show were empty, and answered accordingly. The window now runs to the
 * Saturday that ends next week, wherever in this week today falls, and the
 * header says which dates "השבוע" and "השבוע הבא" are: a model that has to
 * work out which Sunday starts next week is a model that can pick the wrong
 * one.
 *
 * Sunday-first, the Israeli week — the same `weekOf` the calendar draws with.
 * ---------------------------------------------------------------------------
 */
export function rosterWindow(today: string) {
  const thisWeek = weekOf(today);
  const nextWeek = weekOf(shiftDays(today, 7));
  return {
    thisWeek: { from: thisWeek[0], to: thisWeek[6] },
    nextWeek: { from: nextWeek[0], to: nextWeek[6] },
    lastDay: nextWeek[6],
  };
}

/** Days from today to the end of next week, both included. */
export function rosterDays(today: string): number {
  const { lastDay } = rosterWindow(today);
  return (
    Math.round(
      (Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

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
  const { thisWeek, nextWeek, lastDay } = rosterWindow(today);

  const header = [
    `התאריך היום: ${today} (יום ${weekdayLabel(today)}).`,
    `השעה עכשיו: ${clock} (${timezone}).`,
    `השבוע: ${thisWeek.from} עד ${thisWeek.to}. השבוע הבא: ${nextWeek.from} עד ${nextWeek.to}.`,
  ].join("\n");

  if (roster.length === 0) {
    // Said explicitly rather than left as an empty list. "No appointments" is
    // an answer; an absent section invites the model to fill the gap.
    return `${header}\nאין תורים ביומן עד ${lastDay}.`;
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
      "שאר הימים עד סוף השבוע הבא — סיכום בלבד, בלי שמות:",
      ...later.map(([day, rows]) => summaryLine(day, rows, timezone)),
    );
  }

  /**
   * **Where the diary ends is said, not implied.** "Days not shown are empty"
   * was true inside the window and false past it — a question about the week
   * after next read an absent day as a free one. Now the claim stops at the
   * last day that was actually read.
   */
  lines.push(
    truncated
      ? "היומן עמוס: ייתכן שיש תורים שאינם מופיעים כאן."
      : `ימים עד ${lastDay} שאינם מופיעים — אין בהם תורים.`,
    `אחרי ${lastDay} היומן לא מוצג כאן — אל תאמרי שיום כזה ריק.`,
  );

  return lines.join("\n");
}

/** One line of what the browser sent, safe to set inside a prompt. */
function flat(value: string | undefined, max = 80): string {
  return (value ?? "")
    .replace(/["״”“\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The change she is waiting to complete, stated where the model will read it.
 *
 * ---------------------------------------------------------------------------
 * **The conversation already contains it; this makes it unmissable.** The
 * question she asked is the last assistant message, and "לחמש" after it is a
 * continuation any reader would follow — but the model has to rebuild the
 * whole booking from it, day included, on a write that does not ask for
 * confirmation. Stated as data, with the day as a date, the call it makes is a
 * copy rather than a reconstruction.
 *
 * Only reached when `answerDraft` could not place the answer itself: an hour,
 * or a service or provider said in words a list cannot read. The values come
 * from the browser, so they are flattened to one line and bounded; the tool
 * the model then calls re-resolves every one of them.
 * ---------------------------------------------------------------------------
 */
export function draftContext(draft: DraftAction): string {
  if (draft.kind === "move") {
    const name = flat(draft.clientName);
    const day = draft.date && /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : "";
    return [
      "בקשה פתוחה — שאלת לאן להזיז ואת מחכה לתשובה:",
      `הזזת התור של ${name}, שנמצא ${flat(draft.when)}${day ? `, ליום ${day}` : ""}. חסר: ${day ? "שעה" : "שעה או יום"}.`,
      `התשובה נותנת שעה או יום → propose_reschedule_appointment עם name="${name}" והמועד החדש${day ? ` (date="${day}" אם לא נאמר יום אחר)` : ""}. אל תבחרי שעה בעצמך.`,
    ].join("\n");
  }

  const missing = { time: "שעה", service: "שירות", staff: "נותן שירות" }[
    draft.awaiting
  ];
  const known = [
    draft.name ? `ל${flat(draft.name)}` : "בלי שם לקוח",
    `date=${flat(draft.date, 10)}`,
    draft.time ? `time=${flat(draft.time, 5)}` : "",
    draft.service ? `service="${flat(draft.service)}"` : "",
    draft.staff ? `staff="${flat(draft.staff)}"` : "",
  ].filter(Boolean);

  return [
    "בקשה פתוחה — שאלת שאלה ואת מחכה לתשובה:",
    `קביעת תור ${known.join(", ")}. חסר: ${missing}.`,
    "התשובה משלימה את הבקשה → create_appointment עם כל הפרטים האלה ועם התשובה. אל תבחרי בעצמך מה שלא נאמר.",
  ].join("\n");
}
