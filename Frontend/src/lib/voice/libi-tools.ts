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
  sql,
  type SQL,
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
import { getDefaultStaff, listActiveStaff, listAllStaff } from "@/db/queries/staff";
import type { Database } from "@/db/types";
import type { Aftermath } from "@/lib/appointment-aftermath";
import {
  confirmSwap,
  planSwapFor,
  type SwapClash,
  type SwapLeg,
} from "@/lib/appointment-swap";
import { shiftDays, weekOf } from "@/lib/calendar-week";
import { todayInTimezone } from "@/lib/format";
import { normalizePhone } from "@/lib/validation";

import { rosterDays } from "./libi-context";
import { matchNames, nameKey } from "./libi-names";
import {
  spokenChoice,
  spokenDay,
  spokenDuration,
  spokenNext,
  spokenSearch,
  spokenToday,
  spokenTime,
  spokenWeek,
  toward,
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
 *
 * **A missing detail is asked for by the tool, never filled in by it.** A move
 * with no destination, a booking with no hour, no service in a shop that sells
 * several, no provider in a shop with more than one free — each returns a
 * question and a {@link DraftAction} instead of a default. The model is told
 * the same thing, but the tool is what makes it true: a default here is a
 * booking the owner did not ask for, at a length nobody chose.
 * ---------------------------------------------------------------------------
 */

/**
 * Which of a client's bookings is meant, when there is more than one.
 *
 * **Without these, "איזה מהם?" could not be answered.** She reads the times
 * back when a name matches several bookings, and the owner answers "של
 * שתיים" — but the tools took a name and nothing else, so the answer resolved
 * to the same several bookings and she asked again, for ever. The hint picks
 * among the name's matches; it never widens them.
 */
const APPOINTMENT_DATE_HINT =
  "YYYY-MM-DD של התור הקיים — רק כדי לבחור בין כמה תורים של אותו לקוח (למשל אחרי ששאלת 'איזה מהם'). אחרת אל תשלחי.";
const APPOINTMENT_TIME_HINT =
  "HH:MM של התור הקיים — רק כדי לבחור בין כמה תורים של אותו לקוח. אחרת אל תשלחי.";

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
        "כמה תורים יש **היום** ומה נותר היום. טריגרים: כמה תורים יש לי היום, איך נראה היום, סיכום יומי. אסור למחר, לאתמול או ליום נקוב — לאלה עני מהיומן שלמעלה.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_week_summary",
      description:
        "כמה תורים יש השבוע או בשבוע הבא, בכמה ימים ומה היום העמוס. טריגרים: מה יש לי השבוע, מה יש לי בשבוע הבא, איך נראה השבוע הבא, כמה תורים בשבוע הבא. ביקשו לראות את השבוע ביומן (תראי לי את השבוע הבא) — אותו כלי עם show=true.",
      parameters: {
        type: "object",
        properties: {
          week: {
            type: "string",
            enum: ["this", "next"],
            description:
              "this = מעכשיו עד סוף השבוע הזה. next = השבוע הבא, ראשון עד שבת.",
          },
          show: {
            type: "boolean",
            description:
              "true רק כשביקשו לראות את השבוע ביומן. אחרת אל תשלחי את השדה.",
          },
        },
        required: ["week"],
      },
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
          appointment_date: {
            type: "string",
            description: APPOINTMENT_DATE_HINT,
          },
          appointment_time: {
            type: "string",
            description: APPOINTMENT_TIME_HINT,
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
        "מכין הזזה של תור קיים ומחזיר שאלת אישור. אינו מזיז בפועל. לא נאמר לאן להזיז? קראי לו בלי time — הוא ישאל לאיזו שעה או לאיזה יום. אסור לך לבחור שעה בעצמך. טריגרים: תזיזי, הזיזי, תדחי, תקדימי, תעבירי, שני את השעה.",
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
              "היום החדש, YYYY-MM-DD, מחושב מהתאריך שלמעלה. לא נאמר יום — אל תשלחי, ויישמר היום של התור הקיים.",
          },
          time: {
            type: "string",
            description:
              "השעה החדשה, HH:MM בשעון העסק — רק אם נאמרה. לא נאמרה — אל תשלחי את השדה.",
          },
          appointment_date: {
            type: "string",
            description: APPOINTMENT_DATE_HINT,
          },
          appointment_time: {
            type: "string",
            description: APPOINTMENT_TIME_HINT,
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_swap_appointments",
      description:
        "מכין החלפה בין התורים של שני לקוחות — כל אחד עובר למקום של השני — ובודק שאורכי השירותים מתאימים. מחזיר שאלת אישור ואינו מחליף בפועל. לעולם אל תעשי החלפה כשתי הזזות. טריגרים: תחליפי בין, להחליף בין, שיתחלפו, תחליפי את התורים של X ו-Y.",
      parameters: {
        type: "object",
        properties: {
          first_name: { type: "string", description: "שם הלקוח הראשון" },
          second_name: { type: "string", description: "שם הלקוח השני" },
          first_date: { type: "string", description: APPOINTMENT_DATE_HINT },
          first_time: { type: "string", description: APPOINTMENT_TIME_HINT },
          second_date: { type: "string", description: APPOINTMENT_DATE_HINT },
          second_time: { type: "string", description: APPOINTMENT_TIME_HINT },
        },
        required: ["first_name", "second_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_appointment",
      description:
        "קובע תור חדש ותופס את המשבצת. חסרים שעה, שירות או נותן שירות? קראי לו עם מה שנאמר בלבד — הוא ישאל את מה שחסר. לעולם אל תבחרי שירות או נותן שירות בעצמך. מותר גם מחוץ לשעות הפעילות. טלפון אינו נדרש. טריגרים: תקבעי, קבעי, תרשמי, רשמי, תוסיפי, שרייני, תכניסי.",
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
            description:
              "HH:MM בשעון העסק — רק אם נאמרה שעה. לא נאמרה — אל תשלחי.",
          },
          phone: {
            type: "string",
            description:
              "רק אם הוכתב במפורש. אחרת אל תשלחי את השדה.",
          },
          service: {
            type: "string",
            description:
              "שם השירות רק אם נאמר. אחרת אל תשלחי את השדה.",
          },
          staff: {
            type: "string",
            description:
              "שם נותן השירות רק אם נאמר (אצל X). אחרת אל תשלחי את השדה.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_appointment_in_calendar",
      description:
        "פותח את היומן על תור מסוים ומסמן אותו. טריגרים: תראי לי, תפתחי, תציגי, איפה, קפצי ל. משמש כשהמשתמש רוצה לראות תור ביומן ולא רק לשמוע עליו. לשבוע שלם — get_week_summary עם show=true.",
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
  "propose_swap_appointments",
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
    }
  | {
      kind: "swap";
      /** The client named first, and where the swap puts them. */
      first: SwapPendingLeg;
      second: SwapPendingLeg;
    };

/**
 * One side of a described swap. Re-planned and compared on confirmation, never
 * applied as written — see `confirmSwap`.
 */
export type SwapPendingLeg = {
  appointmentId: string;
  clientName: string;
  /** Spoken form of where it is now. */
  when: string;
  /** Spoken form of where it is going. */
  toWhen: string;
  startsAtIso: string;
  targetStartsAtIso: string;
};

/**
 * A change ליבי has begun and cannot finish without one more detail.
 *
 * ---------------------------------------------------------------------------
 * **Not a pending action, and kept apart from one on purpose.** A pending
 * action is complete and waits for yes or no, which a word list answers. A
 * draft is *incomplete* and waits for a detail — an hour, a service, a
 * provider — which is a different question with a different gate: a yes means
 * nothing to it, and an answer to it must never be mistaken for a yes.
 *
 * **Round-trips through the browser like the pending action, and is trusted no
 * more.** The ids in it are re-resolved against this tenant's own lists before
 * they are used, and everything else in it is what the owner said a turn ago
 * — nothing they could not simply say again.
 *
 * **What it buys is the rest of the sentence.** "זקן" is a complete answer to
 * "איזה שירות?" and a meaningless request on its own; the draft is what turns
 * it into "a beard trim for דני tomorrow at three" without a model re-reading
 * the conversation and re-deriving a date it might get wrong on a write that
 * does not ask for confirmation.
 * ---------------------------------------------------------------------------
 */
export type DraftAction =
  | {
      kind: "book";
      /** What she asked for and is waiting to hear. */
      awaiting: "time" | "service" | "staff";
      /** As said; absent books the placeholder name. */
      name?: string;
      /** Shop-local YYYY-MM-DD. */
      date: string;
      /** Shop-local HH:MM, once known. */
      time?: string;
      phone?: string;
      /** Already chosen — re-resolved against this shop's own list on use. */
      serviceId?: string;
      /** The diary's name for it, so the prompt can say it. */
      service?: string;
      staffId?: string;
      staff?: string;
    }
  | {
      kind: "move";
      appointmentId: string;
      clientName: string;
      /** Spoken form of where it is now. */
      when: string;
      startsAtIso: string;
      /** A day already said for the move, when only the hour is missing. */
      date?: string;
    };

/**
 * What a turn changed, for the screen that is showing it.
 *
 * **The calendar is rendered on the server, so it cannot see a write it did
 * not make.** A booking ליבי took used to appear only after the owner
 * reloaded the page — the one moment they were looking at the diary to see
 * whether she had understood. The client refreshes the route when this is
 * present. Ids rather than rows: the refresh re-reads everything, and nothing
 * about a client belongs in a response that only has to say "look again".
 */
export type DiaryChange = {
  kind: "created" | "moved" | "cancelled" | "swapped";
  appointmentIds: string[];
};

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

/**
 * What a tool call produced.
 *
 * `spoken` is what the assistant says. `pending` is present only when a
 * destructive change has been described and is waiting on an answer; `draft`
 * only when a change is waiting on a detail. The client never receives a tool
 * that has already changed something without saying so — and `changed` says
 * so to the screen as well as to the ear.
 *
 * `aftermath` never leaves the server: it is what the write still owes the
 * client (a re-planned reminder, a cancellation notice), run by the route
 * after the answer has been sent.
 */
export type ToolOutcome = {
  spoken: string;
  actionTaken: VoiceToolName | "none" | "confirmed" | "declined";
  pending?: PendingAction;
  draft?: DraftAction;
  navigate?: VoiceNavigation;
  changed?: DiaryChange;
  aftermath?: Aftermath[];
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
  /**
   * The owner's answer to "do several people take bookings here?" — which
   * decides whether a booking goes to the primary provider or has to be
   * placed with somebody. The same flag the booking page reads; see
   * `has_multiple_staff`.
   */
  hasMultipleStaff: boolean;
};

/**
 * Runs one tool call.
 *
 * Unknown names return a spoken refusal rather than throwing: the model chooses
 * these, and a hallucinated tool name should cost the owner a sentence, not a
 * 500 in the middle of a turn.
 *
 * `draft` is the change she was waiting to complete, when there is one. It
 * only ever *narrows*: the appointment a move draft is about wins a tie between
 * several bookings of the same name, and a booking draft lends the service and
 * provider already chosen to the same booking completed in other words.
 */
export async function runVoiceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  { draft }: { draft?: DraftAction } = {},
): Promise<ToolOutcome> {
  switch (name) {
    case "get_next_appointment":
      return nextAppointment(ctx);
    case "get_today_summary":
      return todaySummary(ctx);
    case "get_week_summary":
      return weekSummary(args.week === "next" ? "next" : "this", args.show === true, ctx);
    case "find_client_appointments":
      return findClient(String(args.name ?? ""), ctx);
    case "propose_cancel_appointment":
      return proposeCancel(
        String(args.name ?? ""),
        {
          date: optionalString(args.appointment_date),
          time: optionalString(args.appointment_time),
        },
        ctx,
      );
    case "propose_reschedule_appointment": {
      const move = draft?.kind === "move" ? draft : undefined;
      return proposeReschedule(
        {
          // "לחמש" answers the draft's question with no name in it.
          name: optionalString(args.name) ?? move?.clientName ?? "",
          date: optionalString(args.date) ?? move?.date,
          time: optionalString(args.time),
        },
        {
          date: optionalString(args.appointment_date),
          time: optionalString(args.appointment_time),
          prefer: move?.appointmentId,
        },
        ctx,
      );
    }
    case "propose_swap_appointments":
      return proposeSwap(
        {
          first: String(args.first_name ?? ""),
          second: String(args.second_name ?? ""),
          firstHint: {
            date: optionalString(args.first_date),
            time: optionalString(args.first_time),
          },
          secondHint: {
            date: optionalString(args.second_date),
            time: optionalString(args.second_time),
          },
        },
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
    case "create_appointment": {
      const input: BookingInput = {
        name: optionalString(args.name),
        date: optionalString(args.date),
        time: optionalString(args.time),
        phone: optionalString(args.phone),
        service: optionalString(args.service),
        staff: optionalString(args.staff),
      };
      return createVoiceAppointment(
        draft?.kind === "book" ? lendChoices(input, draft, ctx) : input,
        ctx,
      );
    }
    default:
      return { spoken: "לא הבנתי מה לבדוק ביומן.", actionTaken: "none" };
  }
}

/**
 * A booking completed in the model's own words keeps what was already chosen.
 *
 * "תספורת גבר" was picked a turn ago, the hour arrives now, and the model's
 * call names the client, the day and the hour — but not the service it was
 * never asked about. Lent only to *the same booking* (same client, same day),
 * so a new request made instead of answering starts from nothing, as it
 * should.
 */
function lendChoices(
  input: BookingInput,
  draft: Extract<DraftAction, { kind: "book" }>,
  ctx: ToolContext,
): BookingInput {
  const day = input.date ?? todayInTimezone(ctx.timezone, ctx.now);
  const sameClient =
    nameKey(input.name ?? "") === nameKey(draft.name ?? "");
  if (!sameClient || day !== draft.date) return input;

  return {
    ...input,
    time: input.time ?? draft.time,
    phone: input.phone ?? draft.phone,
    ...(input.service ? {} : { serviceId: draft.serviceId }),
    ...(input.staff ? {} : { staffId: draft.staffId }),
  };
}

/**
 * The beginnings of the words that make a sentence a move.
 *
 * Stems rather than words, because Hebrew conjugates at the end and the
 * transcriber is free to pick any person: "תזיזי", "תזיז", "להזיז", "תדחי",
 * "תקדימי", "תעבירי"…
 */
const MOVE_STEMS = [
  "תזיז",
  "הזיז",
  "להזיז",
  "הזז",
  "תדח",
  "לדחות",
  "תקדימ",
  "להקדים",
  "תעביר",
  "להעביר",
] as const;

/**
 * A move the model read as a lookup, sent where the verb says it belongs.
 *
 * ---------------------------------------------------------------------------
 * **Found in the browser, not in review.** "תזיזי את התור של רפאל שטרן",
 * transcribed perfectly, went to `find_client_appointments` — the model had a
 * client and no destination, and chose the tool that needed nothing more. She
 * read the booking back and stopped, which is exactly the generic answer the
 * owner asked her never to give: a move with no destination has to be a
 * *question*.
 *
 * So the verb decides, the way a word list decides a yes. Only this one
 * direction, and only from a read to a proposal: the proposal finds the same
 * booking the lookup would have, asks where to, and writes nothing until the
 * owner has answered and then agreed. The worst a false reroute costs is one
 * question. The caller skips it for a frozen tenant, who is offered no
 * proposals at all.
 * ---------------------------------------------------------------------------
 */
export function routeByVerb(
  tool: string,
  args: Record<string, unknown>,
  transcript: string,
): { tool: string; args: Record<string, unknown> } {
  if (tool !== "find_client_appointments") return { tool, args };

  const words = transcript.replace(/[^\p{L}\s]/gu, " ").split(/\s+/);
  const moving = words.some((word) =>
    MOVE_STEMS.some((stem) => word.startsWith(stem)),
  );

  return moving
    ? { tool: "propose_reschedule_appointment", args: { name: args.name } }
    : { tool, args };
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

/**
 * Upcoming appointments for a spoken name.
 *
 * ---------------------------------------------------------------------------
 * **Exact first, then a second chance.** The substring match is what a name
 * spelled the way the diary spells it needs, and it is tried first. When it
 * finds nothing, the name is compared against every upcoming client with
 * `matchNames` — vowel letters, a geresh, one letter off — because the name
 * arrived through a transcriber and Hebrew names have several honest
 * spellings before one gets anywhere near them.
 *
 * Every caller speaks the diary's own name back, so a near match is heard, and
 * the destructive ones wait for "כן" as well.
 * ---------------------------------------------------------------------------
 */
async function upcomingFor(name: string, ctx: ToolContext) {
  const upcoming = (condition: SQL | undefined) =>
    ctx.db
      .select(SPOKEN_COLUMNS)
      .from(appointments)
      .where(
        and(
          live(ctx.businessId),
          gt(appointments.startsAt, ctx.now),
          condition,
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(5);

  const exact = await upcoming(
    ilike(appointments.clientName, `%${escapeLike(name)}%`),
  );
  if (exact.length > 0) return exact;

  const near = matchNames(name, await futureClientNames(ctx));
  if (near.length === 0) return [];
  return upcoming(inArray(appointments.clientName, near));
}

/** How many distinct upcoming names the second chance compares against. */
const FUZZY_CANDIDATES = 500;

/** Distinct client names with a live booking still ahead, nearest first. */
async function futureClientNames(ctx: ToolContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ name: appointments.clientName })
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        gt(appointments.startsAt, ctx.now),
        ne(appointments.clientName, PLACEHOLDER_NAME),
      ),
    )
    .groupBy(appointments.clientName)
    .orderBy(sql`min(${appointments.startsAt})`)
    .limit(FUZZY_CANDIDATES);

  return rows.map((row) => row.name);
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

/** `YYYY-MM-DD`, the only date shape a tool accepts. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `H:MM` or `HH:MM`, the only time shape a tool accepts. */
const TIME = /^\d{1,2}:\d{2}$/;

/**
 * What can pick one booking out of several for the same name.
 *
 * `date` and `time` are the booking's *current* day and hour — the owner's
 * answer to "איזה מהם?". `prefer` is the booking a move draft is already
 * about, which wins outright: she asked about that one a turn ago.
 */
type WhichHint = { date?: string; time?: string; prefer?: string };

/**
 * The matches a hint leaves standing: the day first, then the hour — exactly,
 * or failing that the single nearest one, because "של אחת" about a 12:45 is
 * still an answer. A hint that fits nothing leaves the matches as they were
 * rather than emptying them; the question is asked again, not answered wrong.
 */
function narrowByWhen(
  rows: SpokenRow[],
  { date, time }: WhichHint,
  timezone: string,
): SpokenRow[] {
  let out = rows;

  if (date && DATE.test(date)) {
    const onDay = out.filter(
      (row) => formatInTimeZone(row.startsAt, timezone, "yyyy-MM-dd") === date,
    );
    if (onDay.length > 0) out = onDay;
  }

  if (time && TIME.test(time)) {
    const [hour, minute] = time.split(":").map(Number);
    const wanted = hour * 60 + minute;
    const minuteOf = (row: SpokenRow) => {
      const [h, m] = spokenTime(row.startsAt, timezone).split(":").map(Number);
      return h * 60 + m;
    };

    const exact = out.filter((row) => minuteOf(row) === wanted);
    if (exact.length > 0) return exact;

    const distance = (row: SpokenRow) => Math.abs(minuteOf(row) - wanted);
    const nearest = Math.min(...out.map(distance));
    const closest = out.filter((row) => distance(row) === nearest);
    if (closest.length === 1) return closest;
  }

  return out;
}

async function resolveOne(
  name: string,
  ctx: ToolContext,
  verb: string,
  hint: WhichHint = {},
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

  const found = await upcomingFor(trimmed, ctx);

  if (found.length === 0) {
    return {
      ok: false,
      outcome: {
        spoken: `לא מצאתי תורים על השם ${trimmed}.`,
        actionTaken: "none",
      },
    };
  }

  if (found.length > 1) {
    const preferred = hint.prefer
      ? found.find((row) => row.id === hint.prefer)
      : undefined;
    if (preferred) return { ok: true, row: preferred };

    const matches = narrowByWhen(found, hint, ctx.timezone);
    if (matches.length === 1) return { ok: true, row: matches[0] };

    /**
     * The times are read back rather than just counted. "There are two" leaves
     * the owner exactly where they started; "at two and at five, which one"
     * is a question they can answer in the next breath.
     *
     * **And the names, when they differ.** "דני" finds דני כהן and דני לוי; a
     * near match finds איתן אלקיים for "איתי". Reading back only the name the
     * owner said would hide which people were found.
     *
     * **And the days, when they differ.** Two bookings at ten o'clock on
     * different days used to be read back as "ב-10:00 ו-10:00" — a question
     * with no possible answer.
     */
    const dayOf = (row: SpokenRow) =>
      formatInTimeZone(row.startsAt, ctx.timezone, "yyyy-MM-dd");
    const oneDay = matches.every((row) => dayOf(row) === dayOf(matches[0]));
    const at = (row: SpokenRow) =>
      oneDay
        ? `ב-${spokenTime(row.startsAt, ctx.timezone)}`
        : `${spokenDay(row.startsAt, ctx.now, ctx.timezone) || "היום"} ב-${spokenTime(row.startsAt, ctx.timezone)}`;

    const sameName = matches.every(
      (row) => row.clientName === matches[0].clientName,
    );
    const choices = matches
      .map((row) => (sameName ? at(row) : `${row.clientName} ${at(row)}`))
      .join(" ו");
    return {
      ok: false,
      outcome: {
        spoken: sameName
          ? `יש ${matches.length} תורים על השם ${matches[0].clientName} — ${choices}. איזה מהם ${verb}?`
          : `מצאתי ${matches.length} תורים: ${choices}. איזה מהם ${verb}?`,
        actionTaken: "none",
      },
    };
  }

  return { ok: true, row: found[0] };
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
  hint: WhichHint,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const found = await resolveOne(name, ctx, "לבטל", hint);
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
 *
 * **No destination is a question, not a guess.** "תזיזי את התור של דני" has
 * a client and nothing else. It used to come back as a generic "לא שמעתי" —
 * or, worse, as a time the model made up to satisfy a required field. Now the
 * booking is found first, so the question can name it, and the answer comes
 * back as a move draft that holds on to *that* booking: "לחמש" on the next
 * turn moves this דני, not whichever one a fresh lookup finds.
 */
async function proposeReschedule(
  { name, date, time }: { name: string; date?: string; time?: string },
  hint: WhichHint,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const found = await resolveOne(name, ctx, "להזיז", hint);
  if (!found.ok) return found.outcome;

  const row = found.row;
  const currentAt = atPhrase(row.startsAt, ctx);

  /** The same booking, held for the answer to the question she is asking. */
  const waitFor = (onDay?: string): DraftAction => ({
    kind: "move",
    appointmentId: row.id,
    clientName: row.clientName,
    when: currentAt,
    startsAtIso: row.startsAt.toISOString(),
    ...(onDay ? { date: onDay } : {}),
  });

  if (!time || !TIME.test(time)) {
    const onDay = date && DATE.test(date) ? date : undefined;
    return {
      spoken: onDay
        ? `מצאתי תור של ${row.clientName} ${currentAt}. לאיזו שעה ${dayPhrase(onDay, ctx)} להזיז אותו?`
        : `מצאתי תור של ${row.clientName} ${currentAt}. לאיזו שעה או לאיזה יום להזיז אותו?`,
      actionTaken: "none",
      draft: waitFor(onDay),
    };
  }

  const day = date ?? formatInTimeZone(row.startsAt, ctx.timezone, "yyyy-MM-dd");
  const target = toInstant(day, time, ctx.timezone);

  if (!target) {
    return {
      spoken: "לא הצלחתי להבין את המועד החדש. לאיזו שעה ולאיזה יום להזיז?",
      actionTaken: "none",
      draft: waitFor(),
    };
  }

  if (target.getTime() <= ctx.now.getTime()) {
    // A move into the past is always a misheard time, and the constraint would
    // happily accept it.
    return {
      spoken: "המועד הזה כבר עבר. לאיזו שעה להזיז?",
      actionTaken: "none",
      draft: waitFor(),
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
  const toWhen = spokenTime(target, ctx.timezone);

  return {
    spoken: `מצאתי תור של ${row.clientName} ${currentAt}. להזיז אותו ${toward(atPhrase(target, ctx))}?`,
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
 * Why a swap does not fit, in the terms the owner can act on: whose
 * appointment, how long it needs, and who is already there.
 *
 * The one case with nobody else in the way — two bookings far enough apart to
 * exchange start times, where the longer runs into the other's new place — is
 * said as exactly that, rather than as a clash with a stranger.
 */
function swapRefusal(
  clash: SwapClash,
  names: { first: string; second: string },
  timezone: string,
): string {
  const who = clash.leg === "first" ? names.first : names.second;
  const other = clash.leg === "first" ? names.second : names.first;
  const at = spokenTime(clash.startsAt, timezone);
  const needs = spokenDuration(clash.needsMinutes);

  return clash.clientName === other
    ? `אי אפשר להחליף: לתור של ${who} צריך ${needs}, והוא ייגמר אחרי ${at}, כשהתור של ${other} כבר מתחיל. לא שיניתי כלום.`
    : `אי אפשר להחליף: לתור של ${who} צריך ${needs}, וב-${at} כבר יש תור ל${clash.clientName}. לא שיניתי כלום.`;
}

/**
 * Describes a swap between two clients' appointments, and does not perform it.
 *
 * ---------------------------------------------------------------------------
 * **A swap is two moves that only make sense together**, so it is one
 * proposal and one confirmation — never two `propose_reschedule` calls, where
 * the first would be refused by the booking it is about to make room for, or
 * would succeed and leave the second hanging on a "כן" that never comes.
 *
 * **The fit is decided before the question is asked**, by `planSwapFor`: a
 * 60-minute colour does not fit a 30-minute haircut's slot just because the
 * owner wants the two to trade places. Back to back, the two swap order inside
 * the block they already share and the sentence says the new times; anywhere
 * else they exchange start times if that fits, and the refusal names whoever
 * is in the way if it does not. See `appointment-swap`.
 *
 * **Whoever the provider becomes is said out loud.** The slot carries its
 * provider with it, so in a team shop a swap can hand a client to somebody
 * else — which the owner hears before agreeing, not after.
 * ---------------------------------------------------------------------------
 */
async function proposeSwap(
  input: {
    first: string;
    second: string;
    firstHint: WhichHint;
    secondHint: WhichHint;
  },
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const [a, b] = await Promise.all([
    resolveOne(input.first, ctx, "להחליף", input.firstHint),
    resolveOne(input.second, ctx, "להחליף", input.secondHint),
  ]);
  if (!a.ok) return a.outcome;
  if (!b.ok) return b.outcome;

  if (a.row.id === b.row.id) {
    return {
      spoken: `שני השמות הובילו לאותו תור של ${a.row.clientName}. בין אילו שני תורים להחליף?`,
      actionTaken: "none",
    };
  }

  const [first, second] = await Promise.all([
    getAppointment(ctx.db, ctx.businessId, a.row.id),
    getAppointment(ctx.db, ctx.businessId, b.row.id),
  ]);
  if (!first || !second) {
    return {
      spoken: "אחד התורים השתנה בדיוק עכשיו. אפשר לבקש שוב?",
      actionTaken: "none",
    };
  }

  const result = await planSwapFor(ctx.db, ctx.businessId, first, second);
  if (!result.ok) {
    return {
      spoken: swapRefusal(
        result.clash,
        { first: first.clientName, second: second.clientName },
        ctx.timezone,
      ),
      actionTaken: "none",
    };
  }

  const { plan } = result;

  /**
   * Days are said only when they are needed. Two bookings on the same day
   * trading places is the common case, and "ביום ראשון" four times over is
   * noise between the owner and the two times they are listening for — so a
   * shared day is said once, up front, and not at all when it is today.
   */
  const dayOf = (at: Date) => formatInTimeZone(at, ctx.timezone, "yyyy-MM-dd");
  const oneDay = new Set(
    [first.startsAt, second.startsAt, plan.first.startsAt, plan.second.startsAt].map(dayOf),
  ).size === 1;
  const said = (at: Date) =>
    oneDay ? spokenTime(at, ctx.timezone) : atPhrase(at, ctx);
  const sharedDay = dayOf(first.startsAt);
  const dayLead =
    oneDay && sharedDay !== todayInTimezone(ctx.timezone, ctx.now)
      ? `${dayPhrase(sharedDay, ctx)} `
      : "";

  const providersChange = plan.first.staffId !== first.staffId;
  const staffNames = providersChange
    ? new Map(
        (await listAllStaff(ctx.db, ctx.businessId)).map((row) => [row.id, row.name]),
      )
    : new Map<string, string>();
  const withWhom = (leg: SwapLeg) => {
    const name = staffNames.get(leg.staffId);
    return providersChange && name ? ` אצל ${name}` : "";
  };

  // Read in the order the day will run in.
  const legs = [
    { leg: plan.first, name: first.clientName },
    { leg: plan.second, name: second.clientName },
  ].sort((x, y) => x.leg.startsAt.getTime() - y.leg.startsAt.getTime());

  const lead = plan.repacked ? "השירותים באורך שונה, אז " : "";
  const [early, late] = legs;

  return {
    spoken: `${lead}${dayLead}התור של ${early.name} יעבור ${toward(said(early.leg.startsAt))}${withWhom(early.leg)}, והתור של ${late.name} ${toward(said(late.leg.startsAt))}${withWhom(late.leg)}. להחליף?`,
    actionTaken: "propose_swap_appointments",
    pending: {
      kind: "swap",
      first: {
        appointmentId: first.id,
        clientName: first.clientName,
        when: spokenTime(first.startsAt, ctx.timezone),
        toWhen: spokenTime(plan.first.startsAt, ctx.timezone),
        startsAtIso: first.startsAt.toISOString(),
        targetStartsAtIso: plan.first.startsAt.toISOString(),
      },
      second: {
        appointmentId: second.id,
        clientName: second.clientName,
        when: spokenTime(second.startsAt, ctx.timezone),
        toWhen: spokenTime(plan.second.startsAt, ctx.timezone),
        startsAtIso: second.startsAt.toISOString(),
        targetStartsAtIso: plan.second.startsAt.toISOString(),
      },
    },
  };
}

/** A week's worth of rows is a few hundred at most; this only stops a runaway. */
const WEEK_LIMIT = 1000;

/**
 * This week or next, as a count, the days it falls on, and the busiest one.
 *
 * ---------------------------------------------------------------------------
 * **A tool rather than the diary in the prompt**, for the same reason
 * `get_today_summary` is one: "מה יש לי בשבוע הבא?" asks for a sum over days,
 * and a model adding up seven summary lines is a model that can be off by one
 * out loud. The count here is a query; the sentence is `spokenWeek`, which is
 * pure and tested.
 *
 * **This week is what is left of it** — from now, not from Sunday — since the
 * question is about what is coming. **Next week is the whole of it**, Sunday to
 * Saturday: the Israeli week, the one the calendar draws.
 *
 * **It also opens the calendar on that week when asked to show it**, with a
 * path built here from the week's own first day, as `show_appointment_in_calendar`
 * does for one booking.
 * ---------------------------------------------------------------------------
 */
async function weekSummary(
  week: "this" | "next",
  show: boolean,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const today = todayInTimezone(ctx.timezone, ctx.now);
  const days =
    week === "next"
      ? weekOf(shiftDays(today, 7))
      : weekOf(today).filter((day) => day >= today);

  const from =
    week === "next"
      ? fromZonedTime(`${days[0]}T00:00:00`, ctx.timezone)
      : ctx.now;
  const to = fromZonedTime(
    `${shiftDays(days[days.length - 1], 1)}T00:00:00`,
    ctx.timezone,
  );

  const rows = await ctx.db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(WEEK_LIMIT);

  return {
    spoken: spokenWeek(week, rows, ctx.now, ctx.timezone),
    actionTaken: "get_week_summary",
    ...(show
      ? {
          navigate: {
            href: `/dashboard/agenda/full?week=${weekOf(days[0])[0]}&view=week`,
          },
        }
      : {}),
  };
}

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

/** "היום ב-14:00", "מחר ב-14:00", "ביום שלישי ב-14:00" — in the shop's zone. */
function atPhrase(at: Date, ctx: ToolContext): string {
  const when = spokenTime(at, ctx.timezone);
  const day = spokenDay(at, ctx.now, ctx.timezone);
  return day ? `${day} ב-${when}` : `היום ב-${when}`;
}

/**
 * A shop-local date as a day is said — "היום", "מחר", "ביום שלישי".
 *
 * Through `spokenDay` at the day's noon, so a date and an instant are named by
 * one rule and cannot drift into two ways of saying the same Wednesday.
 */
function dayPhrase(date: string, ctx: ToolContext): string {
  const noon = fromZonedTime(`${date}T12:00:00`, ctx.timezone);
  return spokenDay(noon, ctx.now, ctx.timezone) || "היום";
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
 * **Every detail the booking depends on is either said or asked for.** The
 * hour, always. The service, whenever the shop sells more than one — it sets
 * how long the slot is held, so a default is a guess at the length of the
 * owner's afternoon, and an earlier version of this comment called asking
 * "thoroughness that gets a feature switched off". Owners asked for the
 * opposite: a booking under the wrong service is a wrong booking. The
 * provider, whenever the shop is a team and more than one person is free at
 * that hour; one free person is simply booked, and named out loud.
 *
 * Asked **one at a time, in the order the next answer depends on**: the hour
 * decides who is free, the service decides for how long, and only then is
 * "אצל מי?" a question with a correct set of answers. Each question returns a
 * {@link DraftAction} holding everything said so far, so a one-word answer
 * completes the booking — see {@link answerDraft}.
 * ---------------------------------------------------------------------------
 */
type BookingInput = {
  name?: string;
  date?: string;
  time?: string;
  phone?: string;
  /** As spoken — matched against the shop's list. */
  service?: string;
  staff?: string;
  /** Already chosen, from a draft — re-resolved against the shop's list. */
  serviceId?: string;
  staffId?: string;
};

async function createVoiceAppointment(
  input: BookingInput,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const day = input.date ?? todayInTimezone(ctx.timezone, ctx.now);
  const who = input.name?.trim() || undefined;

  if (!DATE.test(day)) {
    return {
      spoken: "לא הבנתי לאיזה יום לקבוע. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  /** Everything said so far, for whichever question comes next. */
  const draft = (
    awaiting: "time" | "service" | "staff",
    chosen: Partial<Extract<DraftAction, { kind: "book" }>> = {},
  ): DraftAction => ({
    kind: "book",
    awaiting,
    ...(who ? { name: who } : {}),
    date: day,
    ...(input.time && TIME.test(input.time) ? { time: input.time } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...chosen,
  });
  const forWhom = who ? ` ל${who}` : "";

  if (!input.time || !TIME.test(input.time)) {
    return {
      spoken: `לאיזו שעה לקבוע את התור${forWhom}?`,
      actionTaken: "none",
      draft: draft("time"),
    };
  }

  const startsAt = toInstant(day, input.time, ctx.timezone);

  if (!startsAt) {
    return {
      spoken: "לא הצלחתי להבין את המועד. אפשר לחזור על זה?",
      actionTaken: "none",
    };
  }

  const [services, team] = await Promise.all([
    listServices(ctx.db, ctx.businessId),
    // A single-staff shop books its primary provider and nobody else — the
    // same rule the booking page follows, whoever else is on the roster.
    ctx.hasMultipleStaff
      ? listActiveStaff(ctx.db, ctx.businessId)
      : getDefaultStaff(ctx.db, ctx.businessId).then((one) => (one ? [one] : [])),
  ]);

  if (team.length === 0 || services.length === 0) {
    // A shop with no active service or provider cannot be booked into by any
    // route, and saying so beats a foreign-key error read out loud.
    return {
      spoken: "אין שירות פעיל ביומן, אז לא הצלחתי לקבוע.",
      actionTaken: "none",
    };
  }

  /**
   * The service: chosen a turn ago, named now, or the only one there is.
   * Anything else is a question — naming the candidates when what was said
   * fits several, and the shop's own list (in the owner's order) when nothing
   * was said at all.
   */
  const named = input.service ? serviceNamed(input.service, services) : null;
  const service =
    (input.serviceId && services.find((row) => row.id === input.serviceId)) ||
    named?.match ||
    (!input.service && services.length === 1 ? services[0] : undefined);

  if (!service) {
    const options = named?.candidates.length ? named.candidates : services;
    const lead =
      input.service && !named?.candidates.length
        ? `לא מצאתי שירות בשם ${input.service}. `
        : "";
    return {
      spoken: `${lead}איזה שירות${forWhom} — ${spokenChoice(options.map((row) => row.name))}?`,
      actionTaken: "none",
      draft: draft("service"),
    };
  }

  const chosenService = { serviceId: service.id, service: service.name };
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  /**
   * The provider. A single-staff shop has exactly one. A team is asked
   * "אצל מי?" — but only among the people actually free for the whole of
   * this service at this hour, since offering somebody who is busy is
   * offering a refusal. One free person is booked without asking; nobody
   * free is said plainly.
   */
  let staff: (typeof team)[number] | undefined;
  let placed = false;

  if (team.length === 1) {
    staff = team[0];
  } else if (input.staffId || input.staff) {
    staff =
      (input.staffId && team.find((row) => row.id === input.staffId)) ||
      (input.staff ? staffNamed(input.staff, team).match : undefined);

    if (!staff) {
      const nearly = input.staff ? staffNamed(input.staff, team).candidates : [];
      const options = nearly.length > 0 ? nearly : team;
      const lead =
        input.staff && nearly.length === 0
          ? `לא מצאתי נותן שירות בשם ${input.staff}. `
          : "";
      return {
        spoken: `${lead}אצל מי — ${spokenChoice(options.map((row) => row.name))}?`,
        actionTaken: "none",
        draft: draft("staff", chosenService),
      };
    }
  } else {
    const busy = await busyStaffBetween(ctx, startsAt, endsAt);
    const free = team.filter((row) => !busy.has(row.id));

    if (free.length === 0) {
      return {
        spoken: `כל נותני השירות תפוסים ${atPhrase(startsAt, ctx)}. תרצה לבחור שעה אחרת?`,
        actionTaken: "none",
      };
    }
    if (free.length > 1) {
      return {
        spoken: `אצל מי${forWhom} — ${spokenChoice(free.map((row) => row.name))}?`,
        actionTaken: "none",
        draft: draft("staff", chosenService),
      };
    }
    staff = free[0];
    placed = true;
  }

  const phone = input.phone ? normalizePhone(input.phone) : "";
  const clientName = who ?? PLACEHOLDER_NAME;
  const isTeam = team.length > 1;

  /**
   * Checked before the insert so the refusal can name who is in the way.
   *
   * The whole range is checked, not the start: a 45-minute cut booked at 14:30
   * runs into a 15:00 appointment even though nothing starts at 14:30, and an
   * owner told "that time is free" who then finds it is not has been told
   * something worse than nothing. Skipped when the provider was just chosen
   * *because* they were free — the read that found them is this read.
   */
  if (!placed) {
    const clash = await conflictFor(ctx, staff.id, startsAt, endsAt);
    if (clash) {
      return {
        spoken: isTeam
          ? `ל${staff.name} יש כבר תור בטווח הזמנים הזה, של ${clash.clientName}. תרצה שעה אחרת או מישהו אחר?`
          : takenSentence(clash.clientName),
        actionTaken: "none",
      };
    }
  }

  let created;
  try {
    created = await createAppointment(ctx.db, {
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
      // The card shows a microphone for these (0034). Distinct from the
      // placeholder flag above: a voice booking *with* a number is an ordinary
      // contactable client that still came from a spoken sentence.
      createdVia: "voice",
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

  /**
   * What was booked, said back: the service whenever there was a choice of
   * one, and the provider whenever there was a choice of those — the two
   * things the owner could otherwise only find out by looking.
   */
  const at = atPhrase(startsAt, ctx);
  const what = services.length > 1 ? `, ${service.name}` : "";
  const where = isTeam ? ` אצל ${staff.name}` : "";
  const changed: DiaryChange = {
    kind: "created",
    appointmentIds: [created.id],
  };

  /**
   * The tip is said **only for a placeholder**, and only once per booking. It
   * is the answer to the question the owner is about to have — "will they get a
   * reminder?" — and repeating it on bookings that *do* carry a number would
   * turn it into noise they stop hearing.
   */
  if (phone === "") {
    return {
      spoken: `רשמתי תור קולי ל${clientName} ${at}${what}${where}. במידה ותרצה לשלוח תזכורת בוואטסאפ, תוכל להוסיף את הטלפון שלו ידנית ביומן.`,
      actionTaken: "create_appointment",
      changed,
    };
  }

  return {
    spoken: `קבעתי תור ל${clientName} ${at}${what}${where}.`,
    actionTaken: "create_appointment",
    changed,
  };
}

/** What a spoken name matched: one row, or the rows it could equally mean. */
type Named<T> = { match?: T; candidates: T[] };

/**
 * The service a spoken name means — or, when it could mean several, which.
 *
 * Four tries, most literal first. The name exactly. A service containing what
 * was said — one is an answer, several are the candidates ("תספורת" in a shop
 * with תספורת גבר and תספורת ילד). What was said containing a service —
 * "תספורת גברים" is "תספורת גבר", the longest one wins. Then a near match,
 * where a tie is candidates too.
 *
 * **A guess between two used to fall back to the shop's first service.** That
 * was a booking at a length nobody chose, and it is now a question naming the
 * two. The fallback was also hiding a miss: "עיצוב זקנים" never contained
 * "עיצוב זקן", because the plural's נ is not the singular's final ן, and the
 * test that said it did passed only because עיצוב זקן sorted first. Names are
 * now compared through `nameKey`, which folds final letters, as the client
 * lookup always did — and without the definite article, which the same test
 * was hiding: a price list says "עיצוב זקן" and a person says "עיצוב הזקן".
 * Stripped from both sides, so a service whose name really begins with ה still
 * meets itself.
 */
function serviceNamed<T extends { name: string }>(
  spoken: string,
  services: readonly T[],
): Named<T> {
  const bare = (value: string) =>
    nameKey(value)
      .split(" ")
      .map((token) => (token.length >= 3 && token.startsWith("ה") ? token.slice(1) : token))
      .join(" ");

  const wanted = bare(spoken.replace(/[!?]/g, ""));
  if (!wanted) return { candidates: [] };

  const keyed = services.map((row) => ({ row, key: bare(row.name) }));

  const exact = keyed.find(({ key }) => key === wanted);
  if (exact) return { match: exact.row, candidates: [] };

  const contained = keyed.filter(({ key }) => key.includes(wanted));
  if (contained.length === 1) return { match: contained[0].row, candidates: [] };
  if (contained.length > 1) {
    return { candidates: contained.map(({ row }) => row) };
  }

  const containing = keyed
    .filter(({ key }) => wanted.includes(key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (containing) return { match: containing.row, candidates: [] };

  const near = matchNames(
    wanted,
    services.map((row) => row.name),
  );
  const nearRows = services.filter((row) => near.includes(row.name));
  return nearRows.length === 1
    ? { match: nearRows[0], candidates: [] }
    : { candidates: nearRows };
}

/** Anything in the Hebrew block — for boundaries `\b` cannot express. */
const HEBREW_LETTER = "[\\u0590-\\u05FF]";

/**
 * The provider a spoken name means.
 *
 * **Whole words, because names nest.** "דני" is inside "דנית", and a plain
 * substring test would hand a booking for דנית to דני. The name has to stand
 * on its own — allowing only the one-letter prefixes Hebrew glues on ("לשירן",
 * "ושירן") — and a near match picks up what the transcriber spelled its own
 * way. A tie is candidates, never a pick.
 */
function staffNamed<T extends { name: string }>(
  spoken: string,
  team: readonly T[],
): Named<T> {
  const heard = spoken.trim();
  if (!heard) return { candidates: [] };

  const standalone = team.filter((row) => {
    const escaped = row.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?<!${HEBREW_LETTER})[ולבהמש]?${escaped}(?!${HEBREW_LETTER})`,
      "i",
    ).test(heard);
  });
  if (standalone.length === 1) return { match: standalone[0], candidates: [] };
  if (standalone.length > 1) {
    // "דני כהן" said in a shop with דני and דני כהן: the longer name is the one
    // that was said.
    const longest = [...standalone].sort((a, b) => b.name.length - a.name.length);
    return longest[0].name.length > longest[1].name.length
      ? { match: longest[0], candidates: [] }
      : { candidates: standalone };
  }

  const names = team.map((row) => row.name);
  const near = new Set(
    heard
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .flatMap((token) => matchNames(token, names)),
  );
  const nearRows = team.filter((row) => near.has(row.name));
  return nearRows.length === 1
    ? { match: nearRows[0], candidates: [] }
    : { candidates: nearRows };
}

/**
 * The providers already holding part of a range, keyed by id.
 *
 * One query for the whole team rather than `conflictFor` per person: "אצל
 * מי?" needs to know who is free before it can be asked, and a round trip per
 * provider is a second per turn in a shop with a few of them.
 */
async function busyStaffBetween(
  ctx: ToolContext,
  startsAt: Date,
  endsAt: Date,
): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ staffId: appointments.staffId })
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
      ),
    );
  return new Set(rows.map((row) => row.staffId));
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

  const dayRows = await ctx.db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        live(ctx.businessId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
      ),
    )
    .orderBy(asc(appointments.startsAt));

  /**
   * The day's bookings for the named client — exact first, then the same
   * second chance `upcomingFor` gives, within the day. A day is a few dozen
   * rows at most, so both happen here rather than in SQL.
   */
  const wantedName = input.name?.trim() ?? "";
  let rows = dayRows;
  if (wantedName.length >= 2) {
    const needle = wantedName.toLowerCase();
    rows = dayRows.filter((row) =>
      row.clientName.toLowerCase().includes(needle),
    );
    if (rows.length === 0) {
      const near = new Set(
        matchNames(
          wantedName,
          dayRows.map((row) => row.clientName),
        ),
      );
      rows = dayRows.filter((row) => near.has(row.clientName));
    }
  }

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
 *
 * **What the write owes afterwards travels back with it** as `aftermath`: the
 * moved appointment's reminder, the cancelled client's notice, the freed slot's
 * waitlist offer — exactly what the dashboard's own buttons do, and what this
 * path used to skip. The route settles it after the answer is sent.
 * ---------------------------------------------------------------------------
 */
export async function executePending(
  pending: PendingAction,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (pending.kind === "swap") return executeSwap(pending, ctx);

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
    const cancelled = await updateAppointmentStatus(
      ctx.db,
      ctx.businessId,
      pending.appointmentId,
      "cancelled",
    );
    return {
      spoken: `ביטלתי את התור של ${pending.clientName} ב-${pending.when}.`,
      actionTaken: "confirmed",
      changed: { kind: "cancelled", appointmentIds: [pending.appointmentId] },
      ...(cancelled
        ? {
            aftermath: [
              {
                kind: "cancelled" as const,
                appointment: cancelled,
                // A request turned down is told so, not told it was cancelled.
                wasRequest: row.status === "pending",
              },
            ],
          }
        : {}),
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

  let moved;
  try {
    moved = await rescheduleAppointment(
      ctx.db,
      ctx.businessId,
      pending.appointmentId,
      {
        startsAt: target,
        endsAt: new Date(target.getTime() + duration),
      },
    );
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
    changed: { kind: "moved", appointmentIds: [pending.appointmentId] },
    ...(moved ? { aftermath: [{ kind: "moved" as const, appointment: moved }] } : {}),
  };
}

/**
 * Applies a swap the owner has agreed to — re-planned, compared, and written
 * in one transaction by `confirmSwap`, which refuses rather than applying a
 * different swap from the one she described.
 */
async function executeSwap(
  pending: Extract<PendingAction, { kind: "swap" }>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { first, second } = pending;

  let result;
  try {
    result = await confirmSwap(ctx.db, ctx.businessId, { first, second });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      // A third booking landed in one of the two places while she asked.
      return {
        spoken: "יש כבר תור באחד המועדים, אז השארתי את שניהם במקום.",
        actionTaken: "none",
      };
    }
    throw error;
  }

  if (!result.ok) {
    return {
      spoken:
        result.reason === "stale"
          ? "התורים השתנו מאז ששאלתי, אז לא נגעתי בהם. אפשר לבדוק ביומן."
          : swapRefusal(
              result.clash,
              { first: result.firstName, second: result.secondName },
              ctx.timezone,
            ),
      actionTaken: "none",
    };
  }

  const [early, late] = [first, second].sort(
    (x, y) => Date.parse(x.targetStartsAtIso) - Date.parse(y.targetStartsAtIso),
  );

  return {
    spoken: `החלפתי: ${early.clientName} ב-${early.toWhen} ו${late.clientName} ב-${late.toWhen}.`,
    actionTaken: "confirmed",
    changed: {
      kind: "swapped",
      appointmentIds: [first.appointmentId, second.appointmentId],
    },
    aftermath: result.rows.map((appointment) => ({
      kind: "moved" as const,
      appointment,
    })),
  };
}

/**
 * How many words an answer to "איזה שירות?" or "אצל מי?" may run to and still
 * be an answer — the bar `libi-confirm` sets for a yes. Past it the owner is
 * saying something new, and the model hears it.
 */
const MAX_ANSWER_WORDS = 6;

/**
 * Completes a booking draft from a bare answer, without the model.
 *
 * ---------------------------------------------------------------------------
 * **The answer to a question she asked is matched against the shop's own
 * list**, the way "כן" is matched against a word list: "זקן" after "איזה
 * שירות?" is the service called זקן, and "אצל שירן" after "אצל מי?" is שירן.
 * That is exact, it skips a model call on a turn that is one word long, and it
 * cannot re-derive tomorrow's date as today's — the draft already holds it.
 *
 * **Anything it cannot place goes to the model**, with the draft stated in the
 * prompt: "זה של הצבע" or "לא משנה, תעשי תספורת" are answers, just not ones a
 * list can read. `null` means exactly that.
 *
 * The hour is never answered here. "בשלוש", "רבע לחמש" and "אחרי הצהריים" are
 * the model's to turn into HH:MM; a second parser for spoken time would be a
 * second place to get "שלוש וחמישה" wrong.
 * ---------------------------------------------------------------------------
 */
export async function answerDraft(
  draft: DraftAction,
  transcript: string,
  ctx: ToolContext,
): Promise<ToolOutcome | null> {
  if (draft.kind !== "book" || draft.awaiting === "time") return null;

  const answer = transcript
    .replace(/[.,!?״"׳']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = answer ? answer.split(" ") : [];
  if (words.length === 0 || words.length > MAX_ANSWER_WORDS) return null;

  const input: BookingInput = {
    name: draft.name,
    date: draft.date,
    time: draft.time,
    phone: draft.phone,
    serviceId: draft.serviceId,
    staffId: draft.staffId,
  };

  if (draft.awaiting === "service") {
    const services = await listServices(ctx.db, ctx.businessId);
    const { match } = serviceNamed(answer, services);
    return match
      ? createVoiceAppointment({ ...input, serviceId: match.id }, ctx)
      : null;
  }

  const team = await listActiveStaff(ctx.db, ctx.businessId);
  const { match } = staffNamed(answer, team);
  return match
    ? createVoiceAppointment({ ...input, staffId: match.id }, ctx)
    : null;
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

/**
 * How much of the diary is read for the prompt.
 *
 * **The window runs to the end of next week**, not seven days: "מה יש לי
 * ביום שלישי הבא?" asked on a Thursday is nine days out, and a seven-day
 * window answered it with an empty day. See `rosterDays`, which the prompt's
 * own header is built from too, so the two cannot disagree about where the
 * diary stops.
 *
 * The read is generous and the prompt is not: `buildPromptContext` lists today
 * and tomorrow in full and turns every other day into one line, so the cap
 * here only has to hold a busy fortnight — the load-tested `demo-barber` put
 * 81 live bookings in one week — and the prompt says so if it is ever reached.
 * The old cap was 25 rows, introduced to the model as the complete week.
 */
export const ROSTER_LIMIT = 600;

export async function upcomingRoster(
  ctx: ToolContext,
  days?: number,
  limit = ROSTER_LIMIT,
): Promise<RosterRow[]> {
  // From the start of the shop's today, not from `now`: an owner asking at
  // 16:00 what their day looked like should see the morning too.
  const day = todayInTimezone(ctx.timezone, ctx.now);
  const from = fromZonedTime(`${day}T00:00:00`, ctx.timezone);
  // Midnight to midnight in the shop's zone, so a DST night cannot move the
  // edge of the window by an hour.
  const to = fromZonedTime(
    `${shiftDays(day, days ?? rosterDays(day))}T00:00:00`,
    ctx.timezone,
  );

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

/**
 * The clients the owner is likely to name, nearest appointment first.
 *
 * ---------------------------------------------------------------------------
 * **The transcriber's most valuable hint, and the one it never had.** Almost
 * every command that changes the diary turns on a client's name, and a general
 * model has no reason to spell "ג'בארין" or "אדמסו" the way this shop's diary
 * does — which matters twice, because the tools then look the name up as
 * written. Handed over as `keywords`, see `libi-vocabulary`.
 *
 * **From the shop's midnight, for a fortnight.** The morning's clients stay in
 * reach ("מה עם דני מהבוקר?"), next week's are in reach for a move, and the cap
 * falls on the furthest away because the order is by each client's *nearest*
 * booking.
 *
 * Names only — never a phone number, for the same reason as the roster — and
 * never the placeholder a voice booking carries, which is a label, not a person.
 * ---------------------------------------------------------------------------
 */
export const CLIENT_NAME_DAYS = 14;

export async function upcomingClientNames(
  ctx: Pick<ToolContext, "db" | "businessId" | "timezone" | "now">,
  limit: number,
  days = CLIENT_NAME_DAYS,
): Promise<string[]> {
  const day = todayInTimezone(ctx.timezone, ctx.now);
  const from = fromZonedTime(`${day}T00:00:00`, ctx.timezone);
  const to = new Date(from.getTime() + days * 86_400_000);

  const rows = await ctx.db
    .select({ name: appointments.clientName })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, ctx.businessId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        ne(appointments.clientName, PLACEHOLDER_NAME),
      ),
    )
    .groupBy(appointments.clientName)
    .orderBy(sql`min(${appointments.startsAt})`, asc(appointments.clientName))
    .limit(limit);

  return rows.map((row) => row.name);
}

/** Re-exported so the route need not know where the speech lives. */
export type { SpokenAppointment };
