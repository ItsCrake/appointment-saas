import {
  listDueNotifications,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
} from "@/db/queries/notifications";
import type { Database } from "@/db/types";

import { daysUntil, GRACE_DAYS } from "@/lib/billing/lifecycle";
import { toPlanType } from "@/lib/plans";

import { buildUrls } from "./enqueue";
import { getProvider } from "./providers";
import { renderNotification } from "./templates";
import { isBillingKind, type NotificationContext } from "./types";

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
  { now = new Date(), limit = 50 }: { now?: Date; limit?: number } = {},
): Promise<DispatchSummary> {
  const due = await listDueNotifications(db, now, limit);
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

      const urls = buildUrls(business, appointment);
      context = {
        kind: notification.kind,
        businessName: business.name,
        businessPhone: business.phone,
        businessAddress: business.address,
        businessTimezone: business.timezone,
        bookingUrl: urls.bookingUrl,
        manageUrl: urls.manageUrl,
        clientName: appointment.clientName,
        serviceName: appointment.serviceName,
        priceCents: appointment.priceCents,
        startsAt: appointment.startsAt.toISOString(),
      };
    }

    const { subject, body } = renderNotification(context);
    const provider = getProvider(notification.channel);

    const result = await provider.send({
      channel: notification.channel,
      recipient: notification.recipient,
      subject,
      body,
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
