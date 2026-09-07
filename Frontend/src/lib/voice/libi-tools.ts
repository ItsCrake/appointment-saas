import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  ne,
} from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { appointments } from "@/db/schema";
import {
  BLOCKING_STATUSES,
  createAppointment,
  getAppointment,
  rescheduleAppointment,
  SlotTakenError,
  updateAppointmentStatus,
} from "@/db/queries/appointments";
import { listServices } from "@/db/queries/services";
import { getDefaultStaff } from "@/db/queries/staff";
import type { Database } from "@/db/types";
import { todayInTimezone } from "@/lib/format";
import { normalizePhone } from "@/lib/validation";

import {
  spokenDay,
  spokenNext,
  spokenSearch,
  spokenToday,
  spokenTime,
  type SpokenAppointment,
} from "./libi-speech";

/**
 * What the assistant is allowed to do, and what it has to ask about first.
 *
 * ---------------------------------------------------------------------------
 * **Reads run. Destructive writes are asked about, out loud, before they
 * happen.** Every tool that only answers a question executes immediately.
 * Moving or cancelling somebody's appointment does not: those tools return a
 * *pending action*, ליבי reads back the client and the time she found, and
 * nothing touches the database until the owner has answered the question she
 * asked. The answer is classified by `libi-confirm`, which is a word list and
 * not a prompt.
 *
 * The reason is the input. This is Hebrew speech, transcribed by a model, in a
 * barbershop with clippers running. `בטל את התור של דנה` and `בדוק את התור של
 * דנה` differ by one consonant, and two clients called דניאל is not an unusual
 * shop. A wrong read is a sentence; a wrong write is somebody turning up to a
 * shop that is not expecting them, and nobody finds out until they do.
 *
 * **Creating is the exception, and the asymmetry is deliberate.** A booking
 * ליבי adds is additive: it takes a slot that was empty, it tells nobody, and
 * undoing it is one tap on a calendar the owner is already looking at. A move
 * or a cancellation destroys an arrangement a *client* is relying on and cannot
 * be undone by the person who is standing there. So `create_appointment` runs,
 * and `propose_*` ask.
 *
 * **What a created appointment is missing is a phone number, on purpose.**
 * Nobody dictates one. Without a number the row cannot be a normal booking —
 * there is no one to remind and no one to notify — so it is marked
 * `isVoicePlaceholder` and does the one job the owner actually wanted: it
 * occupies the slot, so the exclusion constraint keeps an online client from
 * booking over the person the owner just wrote down.
 *
 * **Availability is not consulted, matching `createManualBookingAction`.** The
 * owner may book outside posted hours — squeezing somebody in is most of what a
 * shop's day is — and the guard that actually matters,
 * `appointments_no_overlap_staff`, is enforced by the database on the way in
 * and surfaced here as a sentence rather than a stack trace.
 * ---------------------------------------------------------------------------
 */

/** The tool schema handed to the model. OpenAI's function-calling shape. */
export const VOICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_next_appointment",
      description:
        "התור הקרוב הבא, מעכשיו והלאה. טריגרים: מה התור הבא, מי הבא בתור, מתי התור הבא שלי.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_today_summary",
      description:
        "כמה תורים יש היום ומה נותר. טריגרים: כמה תורים יש לי היום, איך נראה היום, סיכום יומי.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_client_appointments",
      description:
        "תורים עתידיים של לקוח מסוים. טריגרים: מתי מגיע X, יש לי תור ל-X, מתי X אצלי.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "שם הלקוח או חלק ממנו",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_cancel_appointment",
      description:
        "מכין ביטול תור ומחזיר שאלת אישור. אינו מבטל בפועל. טריגרים: תבטלי, בטלי, מחקי, הסירי, לא מגיע, ביטל.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "שם הלקוח שאת התור שלו מבטלים",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_reschedule_appointment",
      description:
        "מכין הזזה של תור קיים למועד אחר ומחזיר שאלת אישור. אינו מזיז בפועל. טריגרים: תזיזי, הזיזי, תדחי, תקדימי, תעבירי, שני את השעה.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "שם הלקוח שאת התור שלו מזיזים",
          },
          date: {
            type: "string",
            description:
              "YYYY-MM-DD, מחושב מהתאריך שלמעלה. לא נאמר תאריך — השאירי ריק ותישמר היום של התור הקיים.",
          },
          time: {
            type: "string",
            description: "HH:MM בשעון העסק",
          },
        },
        required: ["name", "time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_appointment",
      description:
        "קובע תור חדש ותופס את המשבצת. טריגרים: תקבעי, קבעי, תרשמי, רשמי, תוסיפי, שרייני, תכניסי. מותר גם מחוץ לשעות הפעילות. טלפון אינו נדרש.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "שם הלקוח כפי שנאמר. לא נאמר שם — אל תשלחי את השדה.",
          },
          date: {
            type: "string",
            description:
              "YYYY-MM-DD, מחושב מהתאריך שלמעלה. לא נאמר תאריך — היום.",
          },
          time: {
            type: "string",
            description: "HH:MM בשעון העסק",
          },
          phone: {
            type: "string",
            description:
              "רק אם הוכתב במפורש. אחרת אל תשלחי את השדה.",
          },
          service: {
            type: "string",
            description:
              "שם השירות אם נאמר. אחרת אל תשלחי את השדה.",
          },
        },
        required: ["time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_appointment_in_calendar",
      description:
        "פותח את היומן על תור מסוים ומסמן אותו. טריגרים: תראי לי, תפתחי, תציגי, איפה, קפצי ל. משמש כשהמשתמש רוצה לראות תור ביומן ולא רק לשמוע עליו.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "YYYY-MM-DD, מחושב מהתאריך שלמעלה. לא נאמר תאריך — היום.",
          },
          time: {
            type: "string",
            description:
              "HH:MM בשעון העסק, רק אם נאמרה שעה. לא נאמרה — אל תשלחי את השדה.",
          },
          name: {
            type: "string",
            description: "שם הלקוח אם נאמר. אחרת אל תשלחי את השדה.",
          },
        },
        required: [],
      },
    },
  },
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number]["function"]["name"];

/**
 * The tools that only answer questions.
 *
 * Offered instead of the full set to a frozen tenant, whose subscription has
 * lapsed: they can still be told what their day looks like, and nothing they
 * say can change it. Derived from the names rather than kept as a second list,
 * so a tool added above is write-by-default — the direction a mistake here
 * should fail in.
 */
const WRITE_TOOLS: readonly string[] = [
  "propose_cancel_appointment",
  "propose_reschedule_appointment",
  "create_appointment",
];

export const READ_ONLY_TOOLS = VOICE_TOOLS.filter(
  (tool) => !WRITE_TOOLS.includes(tool.function.name),
);

/**
 * A change ליבי has found, described, and not yet made.
 *
 * ---------------------------------------------------------------------------
 * **Round-trips through the client, and is therefore not trusted.** The turn
 * that answers "כן" is a separate HTTP request — there is no session state on
 * this path and adding a store for a value that lives ten seconds would be the
 * wrong trade — so the client sends this back with the next recording. Which
 * means a caller can send anything at all, and `executePending` re-reads the
 * row under the signed-in tenant before it writes. Nothing here is evidence of
 * anything; it is a description of what the owner was asked.
 *
 * **`startsAtIso` is the one field that exists purely to be checked.** Between
 * the question and the answer the appointment can move, be cancelled from
 * another tab, or be taken by the client's own cancel link. Confirming against
 * a row that has changed underneath is exactly the collision this feature was
 * asked for, so a mismatch refuses and says so rather than applying the move to
 * whatever is there now.
 *
 * Times are pre-formatted in the shop's zone. Nothing downstream — not the
 * card, not the sentence — does timezone arithmetic.
 * ---------------------------------------------------------------------------
 */
export type PendingAction =
  | {
      kind: "cancel";
      appointmentId: string;
      clientName: string;
      /** Spoken form of the appointment's current time, e.g. "14:00". */
      when: string;
      /** The instant it started at when the question was asked. */
      startsAtIso: string;
    }
  | {
      kind: "reschedule";
      appointmentId: string;
      clientName: string;
      when: string;
      /** Spoken form of where it is going. */
      toWhen: string;
      startsAtIso: string;
      /** Where it is going, as an instant. Re-derived, never trusted. */
      targetStartsAtIso: string;
      /**
       * The same destination as shop-local `YYYY-MM-DD` and `HH:MM`.
       *
       * Carried so the **tap** path can reach `rescheduleAppointmentAction`,
       * which takes wall-clock strings, without the browser converting an
       * instant into the shop's zone — a calculation nothing on the client is
       * allowed to do here, and one that would silently use the *visitor's*
       * zone for an owner checking the diary from abroad.
       */
      targetDate: string;
      targetTime: string;
    };

/**
 * What a tool call produced.
 *
 * `spoken` is what the assistant says. `pending` is present only when a
 * destructive change has been described and is waiting on an answer; the client
 * never receives a tool that has already changed something without saying so.
 */
/**
 * Somewhere the dashboard should be, because ליבי was asked to show rather
 * than to tell.
 *
 * A path rather than an appointment, so the client pushes it and nothing on
 * this side has to know how the calendar addresses a week. Always same-origin
 * and always built here from ids the tenant owns — never assembled from
 * anything the model wrote.
 */
export type VoiceNavigation = { href: string };

export type ToolOutcome = {
  spoken: string;
  actionTaken: VoiceToolName | "none" | "confirmed" | "declined";
  pending?: PendingAction;
  navigate?: VoiceNavigation;
};

/** Only what a sentence needs. The rest of the row is not the assistant's business. */
const SPOKEN_COLUMNS = {
  id: appointments.id,
  startsAt: appointments.startsAt,
  clientName: appointments.clientName,
  serviceName: appointments.serviceName,
} as const;

const live = (businessId: string) =>
  and(
    eq(appointments.businessId, businessId),
    inArray(appointments.status, [...BLOCKING_STATUSES]),
  );

/** Escapes what `ilike` would otherwise treat as a wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type ToolContext = {
  db: Database;
  businessId: string;
  timezone: string;
  now: Date;
};

/**
 * Runs one tool call.
 *
 * Unknown names return a spoken refusal rather than throwing: the model chooses
 * these, and a hallucinated tool name should cost the owner a sentence, not a
 * 500 in the middle of a turn.
 */
export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  switch (name) {
    case "get_next_appointment":
      return nextAppointment(ctx);
    case "get_today_summary":
      return todaySummary(ctx);
    case "find_client_appointments":
      return findClient(String(args.name ?? ""), ctx);
    case "propose_cancel_appointment":
      return proposeCancel(String(args.name ?? ""), ctx);
    case "propose_reschedule_appointment":
      return proposeReschedule(
        String(args.name ?? ""),
        optionalString(args.date),
        optionalString(args.time),
        ctx,
      );
    case "show_appointment_in_calendar":
      return showInCalendar(
        {
          date: optionalString(args.date),
          time: optionalString(args.time),
          name: optionalString(args.name),
        },
        ctx,
      );
    case "create_appointment":
      return createVoiceAppointment(
        {
          name: optionalString(args.name),
          date: optionalString(args.date),
          time: optionalString(args.time),
          phone: optionalString(args.phone),
          service: optionalString(args.service),
        },
        ctx,
      );
    default:
      return { spoken: "לא הבנתי מה לבדוק ביומן.", actionTaken: "none" };
  }
}

/**
 * An argument the model was told to omit, and sometimes sends as `""` or the
 * string `"null"` anyway. Absent and blank have to mean the same thing here,
 * because blank is how "no phone number was dictated" arrives.
 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

async function nextAppointment(ctx: ToolContext): Promise<ToolOutcome> {
  const [row] = await ctx.db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(and(live(ctx.businessId), gt(appointments.startsAt, ctx.now)))
    .orderBy(asc(appointments.startsAt))
    .limit(1);

  return {
    spoken: spokenNext(row ?? null, ctx.now, ctx.timezone),
    actionTaken: "get_next_appointment",
  };
}

async function todaySummary(ctx: ToolContext): Promise<ToolOutcome> {
  // "Today" is the shop's day. A server in another zone rolls over at a
  // different instant, and an owner asking at 23:30 must not hear tomorrow.
  const day = todayInTimezone(ctx.timezone, ctx.now);
  const dayStart = fromZonedTime(`${day}T00:00:00`, ctx.timezone);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const scope = and(
    live(ctx.businessId),
    gte(appointments.startsAt, dayStart),
    lt(appointments.startsAt, dayEnd),
  );

  const [[totals], [next]] = await Promise.all([
    ctx.db.select({ total: count() }).from(appointments).where(scope),
    ctx.db
      .select(SPOKEN_COLUMNS)
      .from(appointments)
      .where(and(scope, gt(appointments.startsAt, ctx.now)))
      .orderBy(asc(appointments.startsAt))
      .limit(1),
  ]);

  return {
    spoken: spokenToday(totals?.total ?? 0, next ?? null, ctx.timezone),
    actionTaken: "get_today_summary",
  };
}

async function upcomingFor(name: string, ctx: ToolContext) {
  return ctx.db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        gt(appointments.startsAt, ctx.now),
        ilike(appointments.clientName, `%${escapeLike(name)}%`),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(5);
}

async function findClient(name: string, ctx: ToolContext): Promise<ToolOutcome> {
  if (name.trim().length < 2) {
    // Dictation returns an empty string more often than a wrong one, and a
    // bare wildcard would read out the whole diary.
    return { spoken: "לא שמעתי את השם. אפשר לנסות שוב?", actionTaken: "none" };
  }

  const matches = await upcomingFor(name.trim(), ctx);
  return {
    spoken: spokenSearch(name.trim(), matches, ctx.now, ctx.timezone),
    actionTaken: "find_client_appointments",
  };
}

/**
 * Finds the one appointment a spoken name refers to, or explains why it cannot.
 *
 * **Ambiguity refuses rather than guessing, and that is the point of the whole
 * feature.** Two upcoming appointments for one name is exactly when a confident
 * write is most expensive — a shop with a דניאל כהן at two and a דניאל לוי at
 * five, and a sentence that says only "דניאל". So the several-matches branch
 * reads the times back and asks which, rather than taking the first.
 */
type SpokenRow = {
  id: string;
  startsAt: Date;
  clientName: string;
  serviceName: string;
};

type Resolution =
  | { ok: true; row: SpokenRow }
  | { ok: false; outcome: ToolOutcome };

async function resolveOne(
  name: string,
  ctx: ToolContext,
  verb: string,
): Promise<Resolution> {
  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return {
      ok: false,
      outcome: {
        spoken: "לא שמעתי את השם. אפשר לנסות שוב?",
        actionTaken: "none",
      },
    };
  }

  const matches = await upcomingFor(trimmed, ctx);

  if (matches.length === 0) {
    return {
      ok: false,
      outcome: {
        spoken: `לא מצאתי תורים על השם ${trimmed}.`,
        actionTaken: "none",
      },
    };
  }

  if (matches.length > 1) {
    /**
     * The times are read back rather than just counted. "There are two" leaves
     * the owner exactly where they started; "at two and at five, which one"
     * is a question they can answer in the next breath.
     */
    const times = matches
      .map((row) => spokenTime(row.startsAt, ctx.timezone))
      .join(" ו-");
    return {
      ok: false,
      outcome: {
        spoken: `יש ${matches.length} תורים על השם ${trimmed} — ב-${times}. איזה מהם ${verb}?`,
        actionTaken: "none",
      },
    };
  }

  return { ok: true, row: matches[0] };
}

/**
 * Describes the cancellation, and does not perform it.
 *
 * The sentence names the client and the time, because that is the only part the
 * owner can check. `executePending` is what eventually writes, one turn later,
 * after re-reading the row.
 */
async function proposeCancel(
  name: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const found = await resolveOne(name, ctx, "לבטל");
  if (!found.ok) return found.outcome;

  const row = found.row;
  const when = spokenTime(row.startsAt, ctx.timezone);
  const day = spokenDay(row.startsAt, ctx.now, ctx.timezone);
  const at = day ? `${day} ב-${when}` : `היום ב-${when}`;

  return {
    spoken: `מצאתי תור של ${row.clientName} ${at}. לבטל אותו?`,
    actionTaken: "propose_cancel_appointment",
    pending: {
      kind: "cancel",
      appointmentId: row.id,
      clientName: row.clientName,
      when,
      startsAtIso: row.startsAt.toISOString(),
    },
  };
}

/**
 * Describes the move, and does not perform it.
 *
 * The target day defaults to the appointment's **own** day rather than to
 * today: "תזיזי את דניאל לחמש" about a booking that is tomorrow means tomorrow
 * at five, and resolving it to today would quietly propose a move into the
 * past.
 */
async function proposeReschedule(
  name: string,
  date: string | undefined,
  time: string | undefined,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
    return {
      spoken: "לא שמעתי לאיזו שעה להזיז. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  const found = await resolveOne(name, ctx, "להזיז");
  if (!found.ok) return found.outcome;

  const row = found.row;
  const day = date ?? formatInTimeZone(row.startsAt, ctx.timezone, "yyyy-MM-dd");
  const target = toInstant(day, time, ctx.timezone);

  if (!target) {
    return {
      spoken: "לא הצלחתי להבין את המועד החדש. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  if (target.getTime() <= ctx.now.getTime()) {
    // A move into the past is always a misheard time, and the constraint would
    // happily accept it.
    return {
      spoken: "המועד הזה כבר עבר. לאיזו שעה להזיז?",
      actionTaken: "none",
    };
  }

  /**
   * **The clash is found here, not after the owner has agreed.**
   *
   * Checking only on execution would mean asking "להזיז אותו לחמש?", hearing
   * "כן", and *then* saying the slot is taken — a confirmation spent on a move
   * that was never possible. Asked and answered in one turn instead.
   *
   * The row being moved is excluded: a fifteen-minute nudge overlaps its own
   * former range, which the database correctly does not count as a clash.
   */
  const full = await getAppointment(ctx.db, ctx.businessId, row.id);
  const targetEnd = new Date(
    target.getTime() +
      (full ? full.endsAt.getTime() - full.startsAt.getTime() : 0),
  );
  const clash = await conflictFor(
    ctx,
    full?.staffId ?? "",
    target,
    targetEnd,
    row.id,
  );
  if (clash) {
    return { spoken: takenSentence(clash.clientName), actionTaken: "none" };
  }

  const when = spokenTime(row.startsAt, ctx.timezone);
  const fromDay = spokenDay(row.startsAt, ctx.now, ctx.timezone);
  const toWhen = spokenTime(target, ctx.timezone);
  const toDay = spokenDay(target, ctx.now, ctx.timezone);

  const fromAt = fromDay ? `${fromDay} ב-${when}` : `היום ב-${when}`;
  const toAt = toDay ? `${toDay} ב-${toWhen}` : `היום ב-${toWhen}`;

  return {
    spoken: `מצאתי תור של ${row.clientName} ${fromAt}. להזיז אותו ל${toAt}?`,
    actionTaken: "propose_reschedule_appointment",
    pending: {
      kind: "reschedule",
      appointmentId: row.id,
      clientName: row.clientName,
      when,
      toWhen,
      startsAtIso: row.startsAt.toISOString(),
      targetStartsAtIso: target.toISOString(),
      targetDate: formatInTimeZone(target, ctx.timezone, "yyyy-MM-dd"),
      targetTime: formatInTimeZone(target, ctx.timezone, "HH:mm"),
    },
  };
}

/**
 * The appointment already sitting across a range, if there is one.
 *
 * ---------------------------------------------------------------------------
 * **A check in front of the constraint, not instead of it.**
 * `appointments_no_overlap_staff` is what actually guarantees this product
 * cannot double-book, and it stays the backstop — two requests can both pass
 * this read and only one insert survives. What the read buys is the *sentence*:
 * the constraint can only say no, while this can say who is in the way, which
 * is the difference between "that did not work" and "עומר is in that slot".
 *
 * **Scoped to the provider**, because that is what the constraint excludes on.
 * A two-chair shop can take two people at once and refusing that would be
 * inventing a rule the rest of the product does not have.
 *
 * `exclude` is the appointment being moved. A row is never compared against
 * itself by an exclusion constraint, so nudging a booking fifteen minutes —
 * a move that overlaps its own former range — is correctly not a clash, and
 * this has to agree or it would refuse moves the database would accept.
 * ---------------------------------------------------------------------------
 */
async function conflictFor(
  ctx: ToolContext,
  staffId: string,
  startsAt: Date,
  endsAt: Date,
  exclude?: string,
): Promise<{ clientName: string; startsAt: Date } | null> {
  const [row] = await ctx.db
    .select({
      clientName: appointments.clientName,
      startsAt: appointments.startsAt,
    })
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        eq(appointments.staffId, staffId),
        // Half-open, matching the constraint: a booking that ends exactly when
        // the next begins is back-to-back, not a clash.
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
        ...(exclude ? [ne(appointments.id, exclude)] : []),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1);

  return row ?? null;
}

/** The one sentence a clash produces, wherever it is found. */
const takenSentence = (clientName: string) =>
  `יש כבר תור בטווח הזמנים הזה ל${clientName}. תרצה לבחור שעה אחרת?`;

/**
 * Wall-clock in the shop's zone to an instant, or null if it is not a date.
 *
 * Validated by round-tripping rather than by a regex: `fromZonedTime` will
 * cheerfully turn "2026-02-31" into the 3rd of March, and a model that has
 * miscounted the days in a month should get a question rather than a booking a
 * week away from where the owner thinks it is.
 */
function toInstant(
  day: string,
  time: string,
  timezone: string,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const [rawHour, rawMinute] = time.split(":");
  const hour = rawHour.padStart(2, "0");
  if (Number(hour) > 23 || Number(rawMinute) > 59) return null;

  const at = fromZonedTime(`${day}T${hour}:${rawMinute}:00`, timezone);
  if (Number.isNaN(at.getTime())) return null;

  // The round-trip: if the zone gives back a different calendar day, the input
  // was not a real date.
  return formatInTimeZone(at, timezone, "yyyy-MM-dd") === day ? at : null;
}

/**
 * Books the slot.
 *
 * ---------------------------------------------------------------------------
 * **The one tool that writes without asking**, for the reason given at the top
 * of this file: it takes an empty slot rather than undoing an arrangement
 * somebody else is relying on.
 *
 * **A missing phone number is the normal case, not an error.** Nobody dictates
 * one, so the row is created with `""` and `isVoicePlaceholder`, which keeps it
 * out of the clients list and marks it as a slot rather than a contact. When
 * the owner *does* dictate a number the booking is ordinary in every respect —
 * including being reachable for a reminder — so the flag is only set when the
 * number is genuinely absent.
 *
 * **The service and the provider are the shop's defaults when unnamed.** A
 * placeholder is a block of time with a name on it; making the owner say which
 * of four haircuts it is, out loud, to hold a slot they are about to look at
 * anyway, is the kind of thoroughness that gets a feature switched off.
 * ---------------------------------------------------------------------------
 */
async function createVoiceAppointment(
  input: {
    name?: string;
    date?: string;
    time?: string;
    phone?: string;
    service?: string;
  },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!input.time || !/^\d{1,2}:\d{2}$/.test(input.time)) {
    return {
      spoken: "לא שמעתי לאיזו שעה לקבוע. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  const day = input.date ?? todayInTimezone(ctx.timezone, ctx.now);
  const startsAt = toInstant(day, input.time, ctx.timezone);

  if (!startsAt) {
    return {
      spoken: "לא הצלחתי להבין את המועד. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  const [services, staff] = await Promise.all([
    listServices(ctx.db, ctx.businessId),
    getDefaultStaff(ctx.db, ctx.businessId),
  ]);

  if (!staff || services.length === 0) {
    // A shop with no active service or provider cannot be booked into by any
    // route, and saying so beats a foreign-key error read out loud.
    return {
      spoken: "אין שירות פעיל ביומן, אז לא הצלחתי לקבוע.",
      actionTaken: "none",
    };
  }

  /**
   * Named service if one was heard and matches, otherwise the shop's first.
   * `listServices` orders by `sortOrder` then name, which is the order the
   * owner arranged them in — so "the first one" is their own answer to "what
   * do you mostly do", not ours.
   */
  const named = input.service
    ? services.find((row) =>
        row.name.toLowerCase().includes(input.service!.toLowerCase()),
      )
    : undefined;
  const service = named ?? services[0];

  const phone = input.phone ? normalizePhone(input.phone) : "";
  const clientName = input.name?.trim() || PLACEHOLDER_NAME;
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  /**
   * Checked before the insert so the refusal can name who is in the way.
   *
   * The whole range is checked, not the start: a 45-minute cut booked at 14:30
   * runs into a 15:00 appointment even though nothing starts at 14:30, and an
   * owner told "that time is free" who then finds it is not has been told
   * something worse than nothing.
   */
  const clash = await conflictFor(ctx, staff.id, startsAt, endsAt);
  if (clash) {
    return { spoken: takenSentence(clash.clientName), actionTaken: "none" };
  }

  try {
    await createAppointment(ctx.db, {
      businessId: ctx.businessId,
      serviceId: service.id,
      staffId: staff.id,
      startsAt,
      endsAt,
      status: "confirmed",
      clientName,
      clientPhone: phone,
      isVoicePlaceholder: phone === "",
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      /**
       * The constraint, having caught what the read above could not: somebody
       * booked the slot in the milliseconds between them. Rare, and the reason
       * the read is not allowed to be the only check.
       */
      return {
        spoken: "יש כבר תור בטווח הזמנים הזה. תרצה לבחור שעה אחרת?",
        actionTaken: "none",
      };
    }
    throw error;
  }

  const when = spokenTime(startsAt, ctx.timezone);
  const spokenOn = spokenDay(startsAt, ctx.now, ctx.timezone);
  const at = spokenOn ? `${spokenOn} ב-${when}` : `היום ב-${when}`;

  /**
   * The tip is said **only for a placeholder**, and only once per booking. It
   * is the answer to the question the owner is about to have — "will they get a
   * reminder?" — and repeating it on bookings that *do* carry a number would
   * turn it into noise they stop hearing.
   */
  if (phone === "") {
    return {
      spoken: `רשמתי תור קולי ל${clientName} ${at}. במידה ותרצה לשלוח תזכורת בוואטסאפ, תוכל להוסיף את הטלפון שלו ידנית ביומן.`,
      actionTaken: "create_appointment",
    };
  }

  return {
    spoken: `קבעתי תור ל${clientName} ${at}.`,
    actionTaken: "create_appointment",
  };
}

/**
 * Opens the calendar on one booking and says which.
 *
 * ---------------------------------------------------------------------------
 * **A read that also moves the screen.** Nothing is written, so it runs on the
 * first sentence like every other read — the cost of getting it wrong is the
 * owner looking at the wrong Wednesday, which they can see and fix.
 *
 * **The time is a hint, not a filter.** "תראי לי את התור ביום רביעי בארבע"
 * should land on the four o'clock booking, but a diary is full of times
 * nothing starts exactly at — a 16:00 that is really a 15:45 running long, a
 * mis-heard quarter hour. So a stated time picks the *nearest* booking that
 * day rather than an exact match, and the sentence names the time it actually
 * found so a wrong guess is audible rather than silent.
 *
 * **With no time it takes the day's first and says so**, which is the brief's
 * own answer to the ambiguous case and a better one than asking: the owner is
 * looking at the calendar a second later and can see the rest of the day
 * around it.
 * ---------------------------------------------------------------------------
 */
async function showInCalendar(
  input: { date?: string; time?: string; name?: string },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const day = input.date ?? todayInTimezone(ctx.timezone, ctx.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return {
      spoken: "לא הבנתי איזה יום להראות. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  const from = fromZonedTime(`${day}T00:00:00`, ctx.timezone);
  const to = new Date(from.getTime() + 86_400_000);

  const rows = await ctx.db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        ...(input.name && input.name.trim().length >= 2
          ? [ilike(appointments.clientName, `%${escapeLike(input.name.trim())}%`)]
          : []),
      ),
    )
    .orderBy(asc(appointments.startsAt));

  if (rows.length === 0) {
    const who = input.name ? ` על השם ${input.name}` : "";
    return {
      spoken: `לא מצאתי תור${who} ביום הזה.`,
      actionTaken: "none",
    };
  }

  /**
   * The nearest booking to the stated time, or the day's first.
   *
   * Nearest rather than exact: a diary is full of times nothing starts
   * precisely at, and refusing to show anything because 16:00 is really
   * 15:45 would be a correct answer to a question nobody asked.
   */
  const wanted = input.time
    ? toInstant(day, input.time, ctx.timezone)
    : null;

  const target = wanted
    ? rows.reduce((best, row) =>
        Math.abs(row.startsAt.getTime() - wanted.getTime()) <
        Math.abs(best.startsAt.getTime() - wanted.getTime())
          ? row
          : best,
      )
    : rows[0];

  const when = spokenTime(target.startsAt, ctx.timezone);
  const on = spokenDay(target.startsAt, ctx.now, ctx.timezone);
  const at = on ? `${on} ב-${when}` : `היום ב-${when}`;

  /**
   * Built here from the row's own date and id — never from anything the
   * model wrote. `week` anchors the grid, which is what puts the day view on
   * the right day and the week view on the right week.
   */
  const href = `/dashboard/agenda/full?week=${day}&focus=${target.id}`;

  /**
   * The count is said only when it is the reason the answer might surprise:
   * a day with four bookings, asked about with no time, lands on the first
   * one and the owner should know the others are there.
   */
  const others =
    !input.time && rows.length > 1 ? ` יש עוד ${rows.length - 1} באותו יום.` : "";

  return {
    spoken: `הנה התור של ${target.clientName} ${at}.${others}`,
    actionTaken: "show_appointment_in_calendar",
    navigate: { href },
  };
}

/** What an unnamed voice booking is called on the calendar. */
export const PLACEHOLDER_NAME = "תור קולי";

/**
 * Applies a change the owner has now agreed to, having checked it is still the
 * change they agreed to.
 *
 * ---------------------------------------------------------------------------
 * **Everything here is re-read.** The `pending` argument arrived from the
 * browser and is a description, not a capability: the row is fetched under this
 * request's own `businessId`, so an id belonging to another tenant resolves to
 * nothing at all.
 *
 * **And it is re-read against the time it had when the question was asked.**
 * The gap between "להזיז אותו לחמש?" and "כן" is a few seconds, but the client
 * has a cancel link, the owner has other tabs, and a slot that moved in between
 * must not be moved again on the strength of an answer to a different question.
 * ---------------------------------------------------------------------------
 */
export async function executePending(
  pending: PendingAction,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const row = await getAppointment(ctx.db, ctx.businessId, pending.appointmentId);

  const stale =
    !row ||
    !BLOCKING_STATUSES.includes(row.status) ||
    row.startsAt.toISOString() !== pending.startsAtIso;

  if (stale) {
    return {
      spoken: "התור השתנה מאז ששאלתי, אז לא נגעתי בו. אפשר לבדוק ביומן.",
      actionTaken: "none",
    };
  }

  if (pending.kind === "cancel") {
    await updateAppointmentStatus(
      ctx.db,
      ctx.businessId,
      pending.appointmentId,
      "cancelled",
    );
    return {
      spoken: `ביטלתי את התור של ${pending.clientName} ב-${pending.when}.`,
      actionTaken: "confirmed",
    };
  }

  const target = new Date(pending.targetStartsAtIso);
  // The duration travels with the appointment: a move is a move, not a
  // re-pricing, and the service's duration may have been edited since.
  const duration = row.endsAt.getTime() - row.startsAt.getTime();

  /**
   * Checked again on the way in, because the propose-time check is a second or
   * two old and somebody may have taken the slot while ליבי was asking. Named
   * here too — "עומר is in it now" is what an owner can act on.
   */
  const clash = await conflictFor(
    ctx,
    row.staffId,
    target,
    new Date(target.getTime() + duration),
    pending.appointmentId,
  );
  if (clash) {
    return { spoken: takenSentence(clash.clientName), actionTaken: "none" };
  }

  try {
    await rescheduleAppointment(ctx.db, ctx.businessId, pending.appointmentId, {
      startsAt: target,
      endsAt: new Date(target.getTime() + duration),
    });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      // The constraint, catching a slot taken between the check above and this
      // write. No name to give — it was not there a moment ago.
      return {
        spoken: `יש כבר תור בטווח הזמנים הזה, אז השארתי את זה של ${pending.clientName} במקום.`,
        actionTaken: "none",
      };
    }
    throw error;
  }

  return {
    spoken: `הזזתי את התור של ${pending.clientName} ל-${pending.toWhen}.`,
    actionTaken: "confirmed",
  };
}

/**
 * The diary ליבי is allowed to see while she is deciding.
 *
 * ---------------------------------------------------------------------------
 * **Bounded on both axes, on purpose.** Every row here is sent to OpenAI on
 * every turn — so the window is a week and the count is capped, rather than
 * "the calendar". A busy shop's year would be a large prompt, a slow turn and a
 * per-turn bill, for context that answers nothing anybody asked.
 *
 * **No phone numbers, ever.** The transcript and the tool results already leave
 * this machine; a client's number is not needed to say when they are coming,
 * and the cheapest way to keep it out of a third party's logs is not to put it
 * in the request.
 *
 * `status` is carried because a cancelled slot that still reads as booked is
 * worse than no answer — see the note in the prompt builder.
 * ---------------------------------------------------------------------------
 */
export type RosterRow = {
  startsAt: Date;
  clientName: string;
  serviceName: string;
  status: string;
};

/** How far ahead the prompt looks, and how much of it it will carry. */
export const ROSTER_DAYS = 7;
export const ROSTER_LIMIT = 25;

export async function upcomingRoster(
  ctx: ToolContext,
  days = ROSTER_DAYS,
  limit = ROSTER_LIMIT,
): Promise<RosterRow[]> {
  // From the start of the shop's today, not from `now`: an owner asking at
  // 16:00 what their day looked like should see the morning too.
  const day = todayInTimezone(ctx.timezone, ctx.now);
  const from = fromZonedTime(`${day}T00:00:00`, ctx.timezone);
  const to = new Date(from.getTime() + days * 86_400_000);

  return ctx.db
    .select({
      startsAt: appointments.startsAt,
      clientName: appointments.clientName,
      serviceName: appointments.serviceName,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, ctx.businessId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(limit);
}

/** Re-exported so the route need not know where the speech lives. */
export type { SpokenAppointment };
