import type { Appointment, Business } from "@/db/schema";
import { enqueueNotification } from "@/db/queries/notifications";
import type { Database } from "@/db/types";

import type { NotificationKind } from "./types";

/**
 * Which channel carries which message. Email is the only channel wired to a
 * real provider today; switching a row to "sms" is a one-word change once
 * Twilio credentials exist, because the dispatcher resolves providers by
 * channel at send time.
 */
const CLIENT_CHANNEL = "email" as const;
const OWNER_CHANNEL = "email" as const;

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

  if (appointment.clientEmail) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: CLIENT_CHANNEL,
      kind: "booking_confirmation",
      recipient: appointment.clientEmail,
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
  if (hours <= 0 || !appointment.clientEmail) return [];

  const sendAt = new Date(appointment.startsAt.getTime() - hours * 3_600_000);
  if (sendAt.getTime() <= now.getTime()) return [];

  const row = await enqueueNotification(db, {
    businessId: business.id,
    appointmentId: appointment.id,
    channel: CLIENT_CHANNEL,
    kind: "reminder",
    recipient: appointment.clientEmail,
    scheduledFor: sendAt,
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

  if (appointment.clientEmail) {
    const row = await enqueueNotification(db, {
      businessId: business.id,
      appointmentId: appointment.id,
      channel: CLIENT_CHANNEL,
      kind: "cancellation_confirmation",
      recipient: appointment.clientEmail,
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
