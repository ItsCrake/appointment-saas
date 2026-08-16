import { formatFullDateTime } from "@/lib/format";

import type { AppointmentContext, NotificationContext } from "./types";
import { isBillingKind } from "./types";

/**
 * The three Meta-approved WhatsApp templates, and the rule that picks one.
 *
 * ---------------------------------------------------------------------------
 * A business-initiated WhatsApp message — a confirmation, a reminder — needs a
 * template Meta has approved before it will deliver outside the 24-hour service
 * window. Free text is accepted by the API and then dropped by the platform, so
 * the failure is silent unless something on this side refuses first.
 *
 * **This only binds the official Business API path (Twilio).** Green API drives
 * the shop's own account and has no template concept at all, so it keeps
 * sending the rendered Hebrew body. Both remain `NotificationProvider`s and the
 * outbox does not know the difference — which is the same separation that let
 * WhatsApp ship before either account existed.
 *
 * Parameters are **positional**, because Meta's `body` component takes an
 * ordered array and the numbering in the approved copy (`{{1}}`, `{{2}}` …) is
 * fixed at approval time. Reordering this array silently reorders the message a
 * client reads, so the order is asserted by test rather than trusted to review.
 * ---------------------------------------------------------------------------
 */

/** The approved template names, exactly as registered with Meta. */
export const WHATSAPP_TEMPLATES = [
  "appointment_confirmation",
  "reminder_24h",
  "reminder_2h",
] as const;

export type WhatsAppTemplateName = (typeof WHATSAPP_TEMPLATES)[number];

export type WhatsAppTemplate = {
  name: WhatsAppTemplateName;
  /** Meta's language code for the approved copy. */
  language: string;
  /** Ordered body parameters — index 0 fills `{{1}}`. */
  parameters: string[];
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

/**
 * The five variables the approved copy uses, in the order it uses them.
 *
 * Shared across all three templates on purpose: one substitution list means the
 * reminder and the confirmation cannot drift into disagreeing about how a date
 * is written, and Meta approval is per-template so keeping the shapes identical
 * is what makes a fourth template cheap to add.
 *
 * | Slot | Variable          |
 * | ---- | ----------------- |
 * | 1    | client name       |
 * | 2    | business name     |
 * | 3    | date and time     |
 * | 4    | location          |
 * | 5    | manage/cancel URL |
 */
export function templateParameters(context: AppointmentContext): string[] {
  const when = formatFullDateTime(context.startsAt, context.businessTimezone);

  return [
    context.clientName.trim() || ABSENT,
    context.businessName.trim() || ABSENT,
    // One string rather than separate date and time slots: the approved copy
    // reads "ביום שלישי, 20.08.2026 בשעה 14:30" as a single phrase, and
    // splitting it would let a future edit put them in the wrong order.
    `יום ${when.weekday}, ${when.date} בשעה ${when.time}`,
    context.businessAddress?.trim() || ABSENT,
    context.manageUrl.trim() || ABSENT,
  ];
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
 * The template for one outbound message, or null when there is no approved one.
 *
 * Null is a real answer rather than an error, and it is what a caller on the
 * official API must refuse to send on:
 *
 * - **Kinds with no template.** Only three were approved. An approval request, a
 *   rejection, a cancellation and the win-back message have none, so on Twilio
 *   they cannot be sent as WhatsApp at all — `clientDelivery` falls through to
 *   SMS or email, which is the correct outcome rather than a dropped message.
 * - **A lead time neither reminder covers.** A tenant who sets
 *   `reminder_hours_before` to 48 gets a reminder scheduled 48 hours out, and
 *   `reminder_24h` says "tomorrow". Sending it would be a template whose text
 *   contradicts its own timing, so it returns null and the message finds
 *   another channel.
 */
export function whatsappTemplateFor(
  context: NotificationContext,
  options: { leadHours?: number } = {},
): WhatsAppTemplate | null {
  if (isBillingKind(context.kind)) return null;

  const appointment = context as AppointmentContext;

  if (appointment.kind === "booking_confirmation") {
    return {
      name: "appointment_confirmation",
      language: LANGUAGE,
      parameters: templateParameters(appointment),
    };
  }

  if (appointment.kind === "reminder") {
    const name = reminderTemplateFor(options.leadHours);
    if (!name) return null;
    return {
      name,
      language: LANGUAGE,
      parameters: templateParameters(appointment),
    };
  }

  return null;
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
