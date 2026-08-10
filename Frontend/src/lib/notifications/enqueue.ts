import type { Appointment, Business } from "@/db/schema";
import { enqueueNotification } from "@/db/queries/notifications";
import type { Database } from "@/db/types";
import { entitlementsFor } from "@/lib/entitlements";

import { isChannelLive } from "./providers";
import { planReminder } from "./reminder-policy";
import type { NotificationChannel, NotificationKind } from "./types";

/** Owner alerts are always email — the owner has an inbox, by definition. */
const OWNER_CHANNEL = "email" as const;

/**
 * Client messages follow the tenant's entitlements: SMS reminders are a Pro
 * feature, and this is the line that makes that copy true.
 *
 * Two guards, both load-bearing:
 *
 * - `isChannelLive` — an unconfigured channel falls back to the console
 *   provider, which reports success and delivers nothing. Routing a Pro
 *   tenant's reminders to SMS on a deploy with no Twilio keys would silently
 *   stop reminding their clients, which is strictly worse than the email they
 *   were getting before.
 * - entitlement — a lapsed Pro tenant resolves to `free` and lands back on
 *   email, with no separate downgrade path to maintain.
 *
 * **WhatsApp now leads the order**, where it used to be excluded outright. The
 * reason it was excluded has not gone away — it has become one backend of two.
 * See the note at the top of the loop below, and `whatsapp.ts`.
 */
const CLIENT_CHANNEL_PREFERENCE: readonly NotificationChannel[] = [
  "whatsapp",
  "sms",
  "email",
];

type Delivery = { channel: NotificationChannel; recipient: string };

function clientDelivery(
  business: Business,
  appointment: Appointment,
): Delivery | null {
  const entitlements = entitlementsFor(business);

  for (const channel of CLIENT_CHANNEL_PREFERENCE) {
    /**
     * WhatsApp is now *first*, where it used to be excluded entirely.
     *
     * The old reason still stands for one of the two backends: an official
     * Business API message the shop sends first needs a Meta-approved template
     * outside the 24-hour service window, so routing to Twilio WhatsApp
     * without one produces provider rejections rather than messages. Green API
     * drives the shop's own account and has no such rule, which is why
     * `whatsapp.ts` prefers it.
     *
     * `isChannelLive` is what makes the preference safe either way: with no
     * WhatsApp credentials at all the channel resolves to the console
     * provider, and the loop falls through to SMS and then email rather than
     * logging a confirmation nobody receives.
     */
    if (channel === "whatsapp") {
      if (!entitlements.whatsappReminders) continue;
      if (!isChannelLive("whatsapp")) continue;
      const phone = appointment.clientPhone?.trim();
      if (phone) return { channel: "whatsapp", recipient: phone };
      continue;
    }

    if (channel === "sms") {
      if (!entitlements.smsReminders) continue;
      if (!isChannelLive("sms")) continue;
      const phone = appointment.clientPhone?.trim();
      if (phone) return { channel: "sms", recipient: phone };
      continue;
    }

    if (channel === "email") {
      const email = appointment.clientEmail?.trim();
      if (email) return { channel: "email", recipient: email };
    }
  }

  return null;
}

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/** Stable per (kind, appointment) so a repeated call is a no-op. */
function dedupeKey(kind: NotificationKind, appointmentId: string, suffix = "") {
  return `${kind}:${appointmentId}${suffix}`;
}

type EnqueueInput = {
  db: Database;
  business: Business;
  appointment: Appointment;
  now?: Date;
};

/**
 * Fired when a booking is created — from the public flow and from the owner's
 * manual booking alike. Enqueues the client confirmation, the owner alert and
 * the future reminder in one go.
 */
export async function enqueueBookingNotifications({
  db,
  business,
  appointment,
  now = new Date(),
}: EnqueueInput) {
  const queued: string[] = [];
  const delivery = clientDelivery(business, appointment);

  /**
   * A tenant with "תורים באישור" on writes `pending`, and a client who is told
   * their appointment is booked when it is not is the failure this branch
   * exists to prevent — they would turn up.
   */
  const awaitingApproval = appointment.status === "pending";

  if (delivery) {
    const kind = awaitingApproval ? "booking_pending" : "booking_confirmation";
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: delivery.channel,
      kind,
      recipient: delivery.recipient,
      scheduledFor: now,
      dedupeKey: dedupeKey(kind, appointment.id),
    });
    if (row) queued.push(kind);
  }

  if (business.notificationEmail) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: OWNER_CHANNEL,
      kind: "booking_alert",
      recipient: business.notificationEmail,
      scheduledFor: now,
      dedupeKey: dedupeKey("booking_alert", appointment.id),
    });
    if (row) queued.push("booking_alert");
  }

  /**
   * No reminder yet for a request. Reminding someone about an appointment the
   * owner has not agreed to would be the same lie as the confirmation, only
   * arriving the day before. `enqueueApprovalNotifications` schedules it at the
   * moment the answer is yes.
   */
  if (!awaitingApproval) {
    queued.push(...(await enqueueReminder({ db, business, appointment, now })));
  }

  return queued;
}

/**
 * The owner said yes. The client is told, and the reminder they did not get at
 * request time is scheduled now.
 *
 * `appointment` must be the row **after** the update, so its status is
 * `confirmed` — `enqueueReminder` and the dispatcher both check it.
 */
export async function enqueueApprovalNotifications({
  db,
  business,
  appointment,
  now = new Date(),
}: EnqueueInput) {
  const queued: string[] = [];
  const delivery = clientDelivery(business, appointment);

  if (delivery) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: delivery.channel,
      kind: "booking_approved",
      recipient: delivery.recipient,
      scheduledFor: now,
      dedupeKey: dedupeKey("booking_approved", appointment.id),
    });
    if (row) queued.push("booking_approved");
  }

  queued.push(...(await enqueueReminder({ db, business, appointment, now })));

  return queued;
}

/**
 * The owner said no.
 *
 * Deliberately not `cancellation_confirmation`: "התור שלך בוטל" is wrong for
 * something that was never confirmed, and no owner alert is queued because the
 * owner is the one who just did it.
 */
export async function enqueueRejectionNotifications({
  db,
  business,
  appointment,
  now = new Date(),
}: EnqueueInput) {
  const delivery = clientDelivery(business, appointment);
  if (!delivery) return [];

  const row = await enqueueNotification(db, {
    businessId: business.id,
    appointmentId: appointment.id,
    channel: delivery.channel,
    kind: "booking_rejected",
    recipient: delivery.recipient,
    scheduledFor: now,
    dedupeKey: dedupeKey("booking_rejected", appointment.id),
  });

  return row ? ["booking_rejected"] : [];
}

/**
 * Reminders are scheduled at booking time rather than swept for later, so the
 * send time is fixed the moment the client commits. Skipped when the lead time
 * has already passed — a booking made an hour ahead gets no 24h reminder.
 */
export async function enqueueReminder({
  db,
  business,
  appointment,
  now = new Date(),
}: EnqueueInput) {
  const delivery = clientDelivery(business, appointment);
  if (!delivery) return [];

  /**
   * The lead time decides the reminder, not a fixed 24 hours — see
   * `reminder-policy.ts`. A same-day booking used to get nothing at all,
   * because 24 hours before it was already in the past, and that is precisely
   * the client most likely to forget.
   */
  const plan = planReminder({
    startsAt: appointment.startsAt,
    bookedAt: now,
    reminderHoursBefore: business.reminderHoursBefore,
  });
  if (!plan) return [];

  const row = await enqueueNotification(db, {
    businessId: business.id,
    appointmentId: appointment.id,
    channel: delivery.channel,
    kind: "reminder",
    recipient: delivery.recipient,
    scheduledFor: plan.sendAt,
    // The channel is deliberately absent from the key: one reminder per
    // appointment, whatever carries it. Including it would let a plan change
    // between booking and send time queue a second copy. The *lead* is in it,
    // so a booking approved later — and therefore replanned onto the short
    // rule — is not deduped against a reminder that was never scheduled.
    dedupeKey: dedupeKey("reminder", appointment.id, `:${plan.hoursBefore}`),
  });

  return row ? ["reminder"] : [];
}

/** Fired from both the client cancel link and the owner's dashboard action. */
export async function enqueueCancellationNotifications({
  db,
  business,
  appointment,
  now = new Date(),
}: EnqueueInput) {
  const queued: string[] = [];
  const delivery = clientDelivery(business, appointment);

  if (delivery) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: delivery.channel,
      kind: "cancellation_confirmation",
      recipient: delivery.recipient,
      scheduledFor: now,
      dedupeKey: dedupeKey("cancellation_confirmation", appointment.id),
    });
    if (row) queued.push("cancellation_confirmation");
  }

  if (business.notificationEmail) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: OWNER_CHANNEL,
      kind: "cancellation_alert",
      recipient: business.notificationEmail,
      scheduledFor: now,
      dedupeKey: dedupeKey("cancellation_alert", appointment.id),
    });
    if (row) queued.push("cancellation_alert");
  }

  return queued;
}

export function buildUrls(business: Business, appointment: Appointment) {
  const base = appBaseUrl();
  return {
    bookingUrl: `${base}/${business.slug}`,
    manageUrl: `${base}/b/${appointment.cancelToken}`,
  };
}
