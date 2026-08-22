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
import { whatsappSuppressedByConsole } from "@/db/queries/platform-settings";
import type { Database } from "@/db/types";

import { daysUntil, GRACE_DAYS } from "@/lib/billing/lifecycle";
import { toPlanType } from "@/lib/plans";
import { offerDeadline } from "@/lib/waitlist";

import { buildUrls } from "./enqueue";
import { getProvider } from "./providers";
import { renderNotification } from "./templates";
import { isBillingKind, type NotificationContext } from "./types";
import { isWhatsappDispatchDisabled } from "./whatsapp";
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

  /**
   * Read once, before the loop. Fails safe: an unreadable settings table
   * answers "suppressed", because the cost of being wrong here is money and
   * messages to real clients from a deploy that believed it was muted.
   */
  const consoleSuppressed = due.some(
    (r) => r.notification.channel === "whatsapp",
  )
    ? await whatsappSuppressedByConsole(db)
    : false;

  for (const row of due) {
    const { notification, business, appointment, waitlist, waitlistService } =
      row;

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
    } else if (notification.kind === "waitlist_invite") {
      /**
       * The third family, and the only one addressed to somebody with **no
       * appointment yet** — see `WaitlistContext`.
       *
       * Every field is checked rather than assumed: an entry can lose its token
       * or its slot between the row being queued and the sweep reaching it, if
       * the owner withdrew the offer or the entry was booked in the meantime.
       * A message saying "a slot opened" with no slot in it is worse than none,
       * so it is skipped with the reason rather than sent half-formed.
       */
      if (!waitlist?.inviteToken || !waitlist.invitedStartsAt) {
        await markNotificationSkipped(db, notification.id, "invite withdrawn");
        summary.skipped++;
        continue;
      }

      if (waitlist.status === "booked" || waitlist.status === "cancelled") {
        await markNotificationSkipped(
          db,
          notification.id,
          `waitlist entry is ${waitlist.status}`,
        );
        summary.skipped++;
        continue;
      }

      context = {
        kind: "waitlist_invite",
        businessName: business.name,
        businessPhone: business.phone,
        businessAddress: business.address,
        businessTimezone: business.timezone,
        inviteUrl: `${appBaseUrl()}/w/${waitlist.inviteToken}`,
        inviteToken: waitlist.inviteToken,
        clientName: waitlist.clientName,
        serviceName: waitlistService?.name ?? null,
        startsAt: waitlist.invitedStartsAt.toISOString(),
        /**
         * Computed from the same rule the page and the claim action use, so
         * the deadline the message states is the deadline that is enforced. A
         * message promising an hour while the server refuses after thirty
         * minutes would be the worst version of this feature.
         */
        offerExpiresAt:
          business.waitlistOfferTtlMin > 0
            ? (offerDeadline(
                waitlist,
                business.waitlistOfferTtlMin,
              )?.toISOString() ?? null)
            : null,
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

    /**
     * The kill switch, resolved before a provider is even constructed.
     *
     * `whatsapp.ts` refuses to reach the network on its own, so this is not
     * what prevents the charge — it is what keeps the *record* honest.
     * Suppression is a decision we made, so the row is `skipped` with the
     * reason, not `failed`; a fortnight of internal testing would otherwise
     * fill `/master/alerts` with failures that were nothing of the kind, and
     * bury the real ones.
     *
     * **Two sources, combined by OR.** The environment variable is the
     * deploy-time guard; the `/master` toggle is the runtime one. Either can
     * suppress and neither can force sending back on over the other — a switch
     * in a web UI must not be able to start spending money on a deploy whose
     * environment deliberately said no.
     *
     * The console read is resolved once per run rather than per row: it cannot
     * change mid-sweep in any way that matters, and a hundred-row batch should
     * not be a hundred queries.
     */
    if (notification.channel === "whatsapp") {
      const reason = whatsappSuppressionReason(consoleSuppressed);
      if (reason) {
        await markNotificationSkipped(db, notification.id, reason);
        summary.skipped++;
        continue;
      }
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

/**
 * Why a WhatsApp message is being suppressed, or null when it may send.
 *
 * Returns the *reason string* rather than a boolean so the outbox row records
 * which of the two guards stopped it — "it was skipped" is not a useful thing
 * to read three weeks later when nobody remembers which switch was on.
 */
export function whatsappSuppressionReason(
  consoleSuppressed: boolean,
): string | null {
  if (isWhatsappDispatchDisabled()) {
    return "whatsapp dispatch disabled (DISABLE_WHATSAPP_DISPATCH)";
  }
  if (consoleSuppressed) {
    return "whatsapp dispatch disabled (master console toggle)";
  }
  return null;
}
