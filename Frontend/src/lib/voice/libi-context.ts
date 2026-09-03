import { formatInTimeZone } from "date-fns-tz";

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

/** Times in the shop's zone; the model must never do timezone arithmetic. */
function line(row: RosterRow, timezone: string): string {
  const day = formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd");
  const time = formatInTimeZone(row.startsAt, timezone, "HH:mm");
  return `- ${day} (${weekdayLabel(day)}) ${time} · ${row.clientName} · ${row.serviceName} · ${row.status}`;
}

/**
 * The system prompt's context block.
 *
 * Kept pure and separate from the prompt's *instructions* so it can be tested
 * against real rows: the instructions are prose and change with taste, while
 * this is data and has to be exactly right.
 */
export function buildPromptContext(
  now: Date,
  timezone: string,
  roster: readonly RosterRow[],
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

  const todays = roster.filter(
    (row) => formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd") === today,
  );

  return [
    header,
    `תורים היום: ${todays.length}.`,
    "היומן לשבוע הקרוב (זו הרשימה המלאה — אין תורים אחרים):",
    ...roster.map((row) => line(row, timezone)),
  ].join("\n");
}
