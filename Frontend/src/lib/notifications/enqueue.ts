import type { Appointment, Business } from "@/db/schema";
import { enqueueNotification } from "@/db/queries/notifications";
import type { Database } from "@/db/types";
import { entitlementsFor } from "@/lib/entitlements";

import { isChannelLive } from "./providers";
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
 * WhatsApp is deliberately *not* auto-selected even when entitled and
 * configured: a reminder is a business-initiated message, so Meta requires a
 * pre-approved template outside the 24-hour service window. The adapter works;
 * routing to it before that approval exists would produce provider rejections
 * rather than messages. Preference order is the value here, not an oversight.
 */
const CLIENT_CHANNEL_PREFERENCE: readonly NotificationChannel[] = [
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

  if (delivery) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: delivery.channel,
      kind: "booking_confirmation",
      recipient: delivery.recipient,
      scheduledFor: now,
      dedupeKey: dedupeKey("booking_confirmation", appointment.id),
    });
    if (row) queued.push("booking_confirmation");
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

  queued.push(...(await enqueueReminder({ db, business, appointment, now })));

  return queued;
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
  const hours = business.reminderHoursBefore;
  if (hours <= 0) return [];

  const delivery = clientDelivery(business, appointment);
  if (!delivery) return [];

  const sendAt = new Date(appointment.startsAt.getTime() - hours * 3_600_000);
  if (sendAt.getTime() <= now.getTime()) return [];

  const row = await enqueueNotification(db, {
    businessId: business.id,
    appointmentId: appointment.id,
    channel: delivery.channel,
    kind: "reminder",
    recipient: delivery.recipient,
    scheduledFor: sendAt,
    // The channel is deliberately absent from the key: one reminder per
    // appointment, whatever carries it. Including it would let a plan change
    // between booking and send time queue a second copy.
    dedupeKey: dedupeKey("reminder", appointment.id, `:${hours}`),
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
