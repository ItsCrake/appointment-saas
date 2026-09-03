import { and, asc, count, eq, gt, gte, ilike, inArray, lt } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";

import { appointments } from "@/db/schema";
import { BLOCKING_STATUSES } from "@/db/queries/appointments";
import type { Database } from "@/db/types";
import { todayInTimezone } from "@/lib/format";

import {
  spokenNext,
  spokenSearch,
  spokenToday,
  spokenTime,
  type SpokenAppointment,
} from "./bazman-speech";

/**
 * What the assistant is allowed to do, and what it is deliberately not.
 *
 * ---------------------------------------------------------------------------
 * **Reads run. Writes are proposed.** Every tool that only answers a question
 * executes immediately. Every tool that would change a client's appointment
 * returns a *proposal* instead — the owner sees it on the card and confirms
 * with a tap, and the confirmation goes through the same server action the
 * dashboard's own buttons use.
 *
 * That is a deliberate departure from "execute the appropriate database
 * operation", and the reason is the input. This is Hebrew speech, transcribed
 * by a model, in a barbershop with clippers running. `בטל את התור של דנה`
 * and `בדוק את התור של דנה` differ by one consonant. A wrong read is a
 * sentence; a wrong write is a client turning up to a shop that is not
 * expecting them, and nobody finds out until they do. The product already
 * takes this position elsewhere — Libi drafts a booking and the owner confirms
 * it; it does not book.
 *
 * **`create` and `reschedule` are not here at all.** Both need the availability
 * engine, the shop's own posted hours and the `appointments_no_overlap_staff`
 * refusal surfaced as something a person can answer — see PROJECT_PLAN §5. A
 * voice turn is the wrong place to hold that conversation, and the dialogs that
 * already hold it properly are one tap away. `find_client_appointments` is what
 * gets the owner there.
 * ---------------------------------------------------------------------------
 */

/** The tool schema handed to the model. OpenAI's function-calling shape. */
export const VOICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_next_appointment",
      description:
        "מחזיר את התור הקרוב ביותר של בעל העסק, מעכשיו והלאה. משמש כשהמשתמש שואל מה התור הבא שלו.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_today_summary",
      description:
        "מחזיר כמה תורים יש היום ומה התור הקרוב שנותר. משמש לשאלות על סיכום היום.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_client_appointments",
      description:
        "מחפש תורים עתידיים לפי שם לקוח. משמש כשהמשתמש שואל מתי מגיע לקוח מסוים.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "שם הלקוח או חלק ממנו, כפי שנאמר",
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
        "מציע לבטל תור של לקוח. אינו מבטל בפועל — מחזיר הצעה שבעל העסק מאשר במסך. משמש כשהמשתמש מבקש לבטל תור.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "שם הלקוח שאת התור שלו מבקשים לבטל",
          },
        },
        required: ["name"],
      },
    },
  },
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number]["function"]["name"];

/**
 * What a tool call produced.
 *
 * `spoken` is what Siri— what the assistant says. `proposal` is present only
 * for a write, and is what the card turns into a confirm button; the client
 * never receives a tool that has already changed something without saying so.
 */
export type ToolOutcome = {
  spoken: string;
  actionTaken: VoiceToolName | "none";
  proposal?: {
    kind: "cancel";
    appointmentId: string;
    clientName: string;
    /** Pre-formatted in the shop's zone — the card must not do timezone math. */
    when: string;
  };
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
    default:
      return { spoken: "לא הבנתי מה לבדוק ביומן.", actionTaken: "none" };
  }
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
 * The one write, and it does not write.
 *
 * Returns the appointment it *would* cancel, named and timed, so the owner
 * hears and reads the same thing before anything changes. Ambiguity refuses
 * rather than guessing: two upcoming appointments for one name is exactly when
 * a confident cancellation is most expensive.
 */
async function proposeCancel(
  name: string,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (name.trim().length < 2) {
    return { spoken: "לא שמעתי את השם. אפשר לנסות שוב?", actionTaken: "none" };
  }

  const matches = await upcomingFor(name.trim(), ctx);

  if (matches.length === 0) {
    return {
      spoken: `לא מצאתי תורים על השם ${name.trim()}.`,
      actionTaken: "none",
    };
  }

  if (matches.length > 1) {
    return {
      spoken: `יש ${matches.length} תורים על השם ${name.trim()}. אפשר לבטל אותם מהיומן.`,
      actionTaken: "none",
    };
  }

  const [only] = matches;
  const when = spokenTime(only.startsAt, ctx.timezone);

  return {
    spoken: `לבטל את התור של ${only.clientName} בשעה ${when}? צריך לאשר במסך.`,
    actionTaken: "propose_cancel_appointment",
    proposal: {
      kind: "cancel",
      appointmentId: only.id,
      clientName: only.clientName,
      when,
    },
  };
}

/** Re-exported so the route need not know where the speech lives. */
export type { SpokenAppointment };
