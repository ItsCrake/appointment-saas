import { formatFullDateTime } from "@/lib/format";

import type {
  AppointmentContext,
  NotificationContext,
  WhatsAppTemplateRef,
} from "./types";
import { isBillingKind, isWaitlistKind } from "./types";

/**
 * The three Meta-approved WhatsApp templates, and the rule that picks one.
 *
 * ---------------------------------------------------------------------------
 * A business-initiated WhatsApp message — a confirmation, a reminder — needs a
 * template Meta has approved before it will deliver outside the 24-hour service
 * window. Free text is accepted by the API and then dropped by the platform, so
 * the failure is silent unless something on this side refuses first.
 *
 * **This binds the official Business API paths — Meta Cloud and Twilio.** Green
 * API drives the shop's own account and has no template concept at all, so it
 * keeps sending the rendered Hebrew body. All three remain
 * `NotificationProvider`s and the outbox does not know the difference — which is
 * the same separation that let WhatsApp ship before any account existed.
 *
 * **These three shapes are transcribed from the copy Meta actually approved,
 * not designed here.** Names, language, component layout and parameter order
 * are all frozen at approval: changing any of them requires resubmission and a
 * fresh review, so this file follows Meta rather than the other way round.
 *
 * The three do **not** share one parameter list, and an earlier version of this
 * file was wrong to assume they could. The confirmation carries no address; the
 * reminders carry no client name; the confirmation puts the client's name in a
 * *header*, which Meta numbers separately from the body. That is why the
 * approved copy contains two `{{1}}`.
 * ---------------------------------------------------------------------------
 */

/** The approved template names, exactly as registered with Meta. */
export const WHATSAPP_TEMPLATES = [
  "appointment_confirmation",
  "reminder_24h",
  "reminder_2h",
] as const;

export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATES)[number];

export type WhatsAppTemplate = WhatsAppTemplateRef & {
  name: WhatsAppTemplateName;
};

/** Hebrew is the only language the three templates were approved in. */
const LANGUAGE = "he";

/**
 * A placeholder Meta will accept where the tenant left a field blank.
 *
 * An empty string is **rejected** by the Cloud API for a body parameter, so a
 * shop with no address recorded would have every templated message fail rather
 * than arrive without a location. A dash is the smallest thing that keeps the
 * message deliverable and is visibly not an address.
 */
const ABSENT = "—";

function filled(value: string | null | undefined): string {
  return value?.trim() || ABSENT;
}

/** U+200F RIGHT-TO-LEFT MARK — zero width, Bidi class R. */
const RLM = "‏";

/**
 * Anchors a parameter to right-to-left, so the emoji beside it stays put.
 *
 * ---------------------------------------------------------------------------
 * The approved copy puts an emoji at the start of three lines:
 *
 *     ⏰ {{2}}      📅 {{2}}      📍 {{3}}
 *
 * Take the worst one. `⏰ 16:00` contains **no strong directional character at
 * all**: the emoji is Bidi class ON (Other Neutral), the digits are EN
 * (European Number, which is *weak*), and the colon is CS. The Unicode Bidi
 * Algorithm resolves paragraph direction by scanning for the first strong
 * character (rules P2/P3) and defaults to **left-to-right** when it finds none.
 *
 * A client that resolves direction per line rather than per message therefore
 * lays that one line out LTR — putting ⏰ on the left with the time to its
 * right, mirrored against every other line in a Hebrew message. This is the
 * iOS report, and it is not a WhatsApp bug: the text genuinely is directionally
 * ambiguous.
 *
 * RLM is a zero-width character whose Bidi class is R, so it gives P2 the
 * strong right-to-left character it was looking for. The line resolves RTL, the
 * neutral emoji takes the paragraph direction, and it lands on the right where
 * the rest of the message is. Digits still render internally left-to-right —
 * "16:00", never "00:61" — because that is the number handling in the same
 * algorithm and RLM does not touch it.
 *
 * Both ends, not just the front: a trailing number run reaching the end of the
 * line is the other half of the same ambiguity, and a closing mark costs
 * nothing.
 *
 * Chosen over the directional isolates (U+2066–2069), which express this more
 * precisely, because RLM is the older and far more widely honoured control and
 * this text is rendered by clients we do not control on platforms we cannot
 * test.
 * ---------------------------------------------------------------------------
 */
export function anchorRtl(value: string): string {
  return `${RLM}${value}${RLM}`;
}

/**
 * The 📅 slot: "יום שלישי, 20/08/2026".
 *
 * The weekday is part of the string rather than a fourth variable because the
 * approved copy has one placeholder on that line. `formatFullDateTime` is the
 * same formatter the confirmation screen uses, so the message and the page
 * cannot disagree about what day an appointment is on.
 */
export function datePhrase(context: AppointmentContext): string {
  const when = formatFullDateTime(context.startsAt, context.businessTimezone);
  return anchorRtl(`יום ${when.weekday}, ${when.date}`);
}

/** The ⏰ slot: "14:30", in the business's own timezone. */
export function timePhrase(context: AppointmentContext): string {
  return anchorRtl(
    formatFullDateTime(context.startsAt, context.businessTimezone).time,
  );
}

/**
 * The template for one outbound message, or null when there is no approved one.
 *
 * Null is a real answer rather than an error, and it is what a caller on an
 * official API must refuse to send on:
 *
 * - **Kinds this file has no branch for.** Only three are mapped here. Every
 *   other kind returns null, and on the official path that is a **failed send,
 *   not a fallback.**
 *
 *   > This comment used to claim `clientDelivery` "falls through to SMS or
 *   > email". It does not, and production disproved it: the channel is chosen
 *   > **once, at enqueue time**, when WhatsApp is live and therefore wins. By
 *   > the time this returns null the row is already committed to WhatsApp, and
 *   > `metaCloudProvider` refuses it with `retryable: false`. The row goes
 *   > straight to `failed`, the client gets nothing, and nobody is told. See
 *   > the audit in `docs/WHATSAPP_TEMPLATES.md` §2.
 *
 *   As of 2026-08-23 Meta has **seven** active templates while this list has
 *   three: `booking_approved` and `booking_rejected` are approved in Hebrew but
 *   unwired here, and `booking_pending` and `cancellation_confirmation` are
 *   approved in English and need resubmitting. Wiring any of them requires that
 *   template's exact approved component layout — a guessed parameter count is a
 *   rejected send, which is no better than the refusal it replaces.
 * - **A lead time neither reminder covers.** A tenant who sets
 *   `reminder_hours_before` to 48 gets a reminder scheduled 48 hours out, and
 *   `reminder_24h` says "tomorrow". Sending it would be a template whose text
 *   contradicts its own timing, so it returns null — and on WhatsApp that is a
 *   refusal, for the reason above.
 */
export function whatsappTemplateFor(
  context: NotificationContext,
  options: { leadHours?: number } = {},
): WhatsAppTemplate | null {
  /**
   * Two families have no approved template and must never reach the cast below.
   *
   * Billing addresses the owner and was never a WhatsApp kind. **Waitlist
   * invites are the live gap**: they are a real client message with no Meta
   * template yet, and a `WaitlistContext` has no `manageToken` and no price — so
   * a branch that treated one as an appointment would post `undefined` into an
   * approved template's parameters rather than fail. Excluded by name, before
   * the cast, so adding a branch cannot reach them by accident.
   */
  if (isBillingKind(context.kind) || isWaitlistKind(context.kind)) return null;

  const appointment = context as AppointmentContext;

  /**
   * Approved copy:
   *
   *   header  שלום {{1}},
   *   body    *התור ל{{1}} נקבע בהצלחה!*
   *           📅 {{2}}
   *           ⏰ {{3}}
   *   button  ניהול התור → https://www.bazman.app/{{1}}
   *
   * Header `{{1}}` is the client; body `{{1}}` is the business. Two variables
   * with the same number, in different components — see `WhatsAppTemplateRef`.
   */
  if (appointment.kind === "booking_confirmation") {
    return {
      name: "appointment_confirmation",
      language: LANGUAGE,
      header: [filled(appointment.clientName)],
      parameters: [
        filled(appointment.businessName),
        datePhrase(appointment),
        timePhrase(appointment),
      ],
      buttonUrlSuffix: manageSuffix(appointment),
    };
  }

  /**
   * Approved copy, both reminders — no header, and the same three body slots:
   *
   *   body    *מחר מתוכנן לך תור ל{{1}}.*   /   בעוד שעתיים יגיע תורך ב{{1}}.
   *           ⏰ {{2}}
   *           📍 {{3}}
   *
   * The two differ only in their prose and in whether they carry a button.
   */
  if (appointment.kind === "reminder") {
    const name = reminderTemplateFor(options.leadHours);
    if (!name) return null;

    return {
      name,
      language: LANGUAGE,
      parameters: [
        filled(appointment.businessName),
        timePhrase(appointment),
        // 📍 is the third emoji line, and an address is the parameter most
        // likely to *start* with a strong left-to-right character — "Dizengoff
        // 100" resolves that line LTR and mirrors the pin exactly as the time
        // line does.
        anchorRtl(filled(appointment.businessAddress)),
      ],
      /**
       * `reminder_24h` was approved with a management button and `reminder_2h`
       * without one. Sending a button parameter for a template that has no
       * button is rejected by the Cloud API, so this is a property of the
       * approved artifact rather than a preference.
       */
      ...(name === "reminder_24h"
        ? { buttonUrlSuffix: manageSuffix(appointment) }
        : {}),
    };
  }

  return null;
}

/**
 * What goes after the button's approved base URL.
 *
 * The base is `https://www.bazman.app/` — **without** `b/`, because that is how
 * it was registered — so the tail is the bare cancel token and the resulting
 * link is `https://www.bazman.app/<token>`. `proxy.ts` is what makes that URL
 * resolve; see `classifyPublicPath`.
 *
 * `filled` rather than the raw token because a blank body or button parameter
 * fails the *entire* send: a dud link is a worse message, but no message at all
 * is a worse outcome. The column is `not null` and always a `randomUUID`, so
 * this is a guard rather than a path anything reaches.
 */
function manageSuffix(context: AppointmentContext): string {
  return filled(context.manageToken);
}

/**
 * How far before the appointment a reminder goes out, derived from when it is
 * actually scheduled rather than stored.
 *
 * The outbox has one `reminder` kind for both reminders — the lead lives in the
 * dedupe key, which is not something to parse. Recomputing it from
 * `scheduledFor` against `startsAt` is derived from the two columns that
 * decide it, so a reminder rescheduled by any future path stays correctly
 * labelled.
 */
export function leadHoursFor(startsAt: Date, scheduledFor: Date): number {
  return Math.round((startsAt.getTime() - scheduledFor.getTime()) / 3_600_000);
}

/**
 * Exactly the two approved leads, and nothing near them.
 *
 * Deliberately not a "closest match": rounding a 36-hour reminder onto the
 * 24-hour template would send copy that says tomorrow, a day and a half early.
 * An unapproved lead has no template and the caller routes around it.
 */
export function reminderTemplateFor(
  leadHours: number | undefined,
): Extract<WhatsAppTemplateName, `reminder_${string}`> | null {
  if (leadHours === 24) return "reminder_24h";
  if (leadHours === 2) return "reminder_2h";
  return null;
}
