import type { Appointment, Business, WaitlistEntry } from "@/db/schema";
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

/**
 * Narrowed to what this actually reads, rather than taking a whole appointment.
 *
 * A waitlist invite has no booking to describe — it is an offer of a slot that
 * has none — but it does have a person to reach, and the channel preference,
 * the entitlement gates and the live-channel checks below are identical. Widening
 * the parameter is honest; casting an entry into an `Appointment` to get past
 * the signature would not be.
 */
type Recipient = {
  clientPhone: string | null;
  clientEmail: string | null;
};

function clientDelivery(
  business: Business,
  appointment: Recipient,
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
      if (!entitlements.canSendWhatsapp) continue;
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

/**
 * Offers one freed slot to one waiting client (0024).
 *
 * ---------------------------------------------------------------------------
 * **Goes through the outbox like every other message**, which is the point: the
 * row is what `/master` counts, what the sweep retries, and what makes a
 * waitlist invite's cost visible next to every other WhatsApp the platform
 * sends. A direct send would have been fewer moving parts and invisible to all
 * three.
 *
 * `clientDelivery` is reused unchanged, so an invite follows the same channel
 * preference and the same entitlement gates as a confirmation — a shop without
 * WhatsApp falls back exactly as it does everywhere else.
 *
 * The dedupe key includes the **slot**, not just the entry: one person may be
 * offered several different openings over a week, and a key naming only the
 * entry would silently swallow every offer after the first.
 * ---------------------------------------------------------------------------
 */
export async function enqueueWaitlistInvite({
  db,
  business,
  entry,
  now = new Date(),
}: {
  db: Database;
  business: Business;
  /** Must already carry its invite token and slot — see `markWaitlistInvited`. */
  entry: WaitlistEntry;
  now?: Date;
}) {
  if (!entry.invitedStartsAt) return [];

  const delivery = clientDelivery(business, {
    clientPhone: entry.clientPhone,
    // A waitlist entry has no email: the public form asks for a phone, because
    // the whole value of an invite is that it arrives while the slot is still
    // free. Null so the email branch is skipped rather than guessed at.
    clientEmail: null,
  });

  if (!delivery) return [];

  const row = await enqueueNotification(db, {
    businessId: business.id,
    waitlistEntryId: entry.id,
    channel: delivery.channel,
    kind: "waitlist_invite",
    recipient: delivery.recipient,
    scheduledFor: now,
    dedupeKey: dedupeKey(
      "waitlist_invite",
      entry.id,
      `:${entry.invitedStartsAt.toISOString()}`,
    ),
  });

  return row ? ["waitlist_invite"] : [];
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

/**
 * The win-back message (0021), queued by the daily retention sweep.
 *
 * Three things about it differ from every other enqueue in this file, and all
 * three follow from it being **marketing rather than a message about a booking
 * the client made**:
 *
 * - **WhatsApp only, no channel preference walk.** `clientDelivery` exists to
 *   find *some* way to reach a client about their own appointment, falling
 *   back until one works. There is no equivalent duty here: if WhatsApp is not
 *   live the correct outcome is to send nothing at all, which the sweep has
 *   already established before calling this.
 * - **The dedupe key is the lapsed appointment**, not the kind and a window.
 *   So a client who never returns gets exactly one message, ever, and one who
 *   does return becomes eligible again only after a *new* visit has lapsed.
 *   A time-bucketed key would have re-sent on a schedule, which is the shape
 *   of the thing everyone means by spam.
 * - **It is scheduled for `now`.** There is nothing in the future to lead.
 */
export async function enqueueWinBack({
  db,
  business,
  candidate,
  now = new Date(),
}: {
  db: Database;
  business: Business;
  candidate: { phone: string; appointmentId: string };
  now?: Date;
}): Promise<boolean> {
  const phone = candidate.phone.trim();
  if (!phone) return false;

  const row = await enqueueNotification(db, {
    businessId: business.id,
    // Carried so the dispatcher can resolve the client's name and the booking
    // link from the row it already loads, rather than growing a third context
    // shape for one template.
    appointmentId: candidate.appointmentId,
    channel: "whatsapp",
    kind: "client_winback",
    recipient: phone,
    scheduledFor: now,
    dedupeKey: dedupeKey("client_winback", candidate.appointmentId),
  });

  return Boolean(row);
}

export function buildUrls(business: Business, appointment: Appointment) {
  const base = appBaseUrl();
  return {
    bookingUrl: `${base}/${business.slug}`,
    manageUrl: `${base}/b/${appointment.cancelToken}`,
  };
}
