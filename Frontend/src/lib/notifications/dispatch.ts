import {
  listDueNotifications,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
} from "@/db/queries/notifications";
import {
  hasNoUpcomingBooking,
  isOptedOutOfMarketing,
} from "@/db/queries/retention-guards";
import type { Database } from "@/db/types";

import { daysUntil, GRACE_DAYS } from "@/lib/billing/lifecycle";
import { toPlanType } from "@/lib/plans";

import { buildUrls } from "./enqueue";
import { getProvider } from "./providers";
import { renderNotification } from "./templates";
import { isBillingKind, type NotificationContext } from "./types";
import { leadHoursFor, whatsappTemplateFor } from "./whatsapp-templates";

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/** Hebrew tier names, for billing copy. Kept local to avoid pulling the whole
 *  pricing table into the dispatcher for one string. */
const PLAN_LABELS: Record<string, string> = {
  free: "חינמי",
  starter: "בסיסי",
  pro: "מקצועי",
};

export type DispatchSummary = {
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Sends every due message. Safe to run concurrently with itself in the sense
 * that duplicates cannot be *created* (dedupe_key), though two overlapping
 * runs could double-send a single row — acceptable for a once-a-minute cron,
 * and fixable with SELECT ... FOR UPDATE SKIP LOCKED if it ever matters.
 */
export async function dispatchDueNotifications(
  db: Database,
  {
    now = new Date(),
    limit = 50,
    appointmentId,
  }: { now?: Date; limit?: number; appointmentId?: string } = {},
): Promise<DispatchSummary> {
  const due = await listDueNotifications(db, now, limit, appointmentId);
  const summary: DispatchSummary = {
    considered: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const row of due) {
    const { notification, business, appointment } = row;

    let context: NotificationContext;

    if (isBillingKind(notification.kind)) {
      // Billing messages address the tenant about their own account and have
      // no appointment by design. Before 0012 this loop skipped every row
      // without one, so these would have inserted cleanly and then vanished.
      // The deadline comes from the tenant's own clock, resolved now rather
      // than when the row was queued. `scheduled_for` is when we chose to
      // *send*, which is a different date and would quietly tell an owner the
      // wrong day to pay by.
      const graceEnd = business.graceStartedAt
        ? new Date(business.graceStartedAt.getTime() + GRACE_DAYS * 86_400_000)
        : null;
      const deadline =
        notification.kind === "trial_ending" ? business.trialEndsAt : graceEnd;

      context = {
        kind: notification.kind,
        businessName: business.name,
        businessTimezone: business.timezone,
        billingUrl: `${appBaseUrl()}/dashboard/billing`,
        planName: PLAN_LABELS[toPlanType(business.planType)] ?? "",
        deadline: deadline?.toISOString(),
        daysLeft:
          business.trialEndsAt && notification.kind === "trial_ending"
            ? Math.max(daysUntil(business.trialEndsAt, now), 0)
            : undefined,
      };
    } else {
      if (!appointment) {
        await markNotificationSkipped(
          db,
          notification.id,
          "appointment missing",
        );
        summary.skipped++;
        continue;
      }

      // The state may have moved on since this was queued. A reminder for a
      // cancelled appointment is the case that actually bites in production.
      if (
        notification.kind === "reminder" &&
        appointment.status !== "confirmed" &&
        appointment.status !== "pending"
      ) {
        await markNotificationSkipped(
          db,
          notification.id,
          `appointment is ${appointment.status}`,
        );
        summary.skipped++;
        continue;
      }

      /**
       * The same re-check, for the message where being wrong is most
       * embarrassing: "we have not seen you in a while" sent to somebody who
       * booked yesterday.
       *
       * The eligibility query already excludes anyone with a future booking,
       * but it runs when the row is *queued*. A row that failed a send and is
       * being retried, or one queued minutes before the client rebooked, is
       * exactly the gap this closes — and unlike a reminder, this message has
       * no deadline, so skipping it costs nothing at all.
       */
      if (notification.kind === "client_winback") {
        const stillLapsed = await hasNoUpcomingBooking(
          db,
          notification.businessId,
          appointment.clientPhone,
          now,
        );
        if (!stillLapsed) {
          await markNotificationSkipped(db, notification.id, "client rebooked");
          summary.skipped++;
          continue;
        }

        if (
          await isOptedOutOfMarketing(
            db,
            notification.businessId,
            appointment.clientPhone,
          )
        ) {
          await markNotificationSkipped(db, notification.id, "opted out");
          summary.skipped++;
          continue;
        }
      }

      const urls = buildUrls(business, appointment);
      context = {
        kind: notification.kind,
        businessName: business.name,
        businessPhone: business.phone,
        businessAddress: business.address,
        businessTimezone: business.timezone,
        bookingUrl: urls.bookingUrl,
        manageUrl: urls.manageUrl,
        manageToken: appointment.cancelToken,
        clientName: appointment.clientName,
        serviceName: appointment.serviceName,
        priceCents: appointment.priceCents,
        startsAt: appointment.startsAt.toISOString(),
        status: appointment.status,
      };
    }

    const { subject, body } = renderNotification(context);
    const provider = getProvider(notification.channel);

    /**
     * Resolved here, at dispatch, rather than stored on the row.
     *
     * The lead time is what picks between `reminder_24h` and `reminder_2h`, and
     * it is derivable from two columns the row already has — so deriving it
     * keeps a rescheduled reminder correctly labelled without a migration, and
     * without a second source of truth to drift.
     */
    const template =
      notification.channel === "whatsapp"
        ? whatsappTemplateFor(context, {
            leadHours: appointment
              ? leadHoursFor(appointment.startsAt, notification.scheduledFor)
              : undefined,
          })
        : null;

    const result = await provider.send({
      channel: notification.channel,
      recipient: notification.recipient,
      subject,
      body,
      ...(template ? { template } : {}),
    });

    if (result.ok) {
      await markNotificationSent(db, notification.id, new Date());
      summary.sent++;
    } else {
      await markNotificationFailed(
        db,
        notification.id,
        `${provider.name}: ${result.error}`,
        result.retryable,
      );
      summary.failed++;
    }
  }

  return summary;
}
