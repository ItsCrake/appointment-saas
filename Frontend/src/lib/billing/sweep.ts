import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

import { businesses } from "@/db/schema";
import { enqueueNotification } from "@/db/queries/notifications";
import { getOwnerEmails } from "@/db/queries/admin";
import type { Database } from "@/db/types";
import { reportError, reportWarning } from "@/lib/observability";
import { toSubscriptionStatus } from "@/lib/plans";

import { planTransition, type LifecycleRow } from "./lifecycle";

/**
 * The job that finally acts on `trial_ends_at` instead of only reporting it.
 *
 * Rides the existing daily cron rather than taking a second entry, matching the
 * precedent set by the rate-limit prune. Daily granularity is genuinely correct
 * here, unlike for booking confirmations: a trial clock is measured in days, so
 * running hourly would buy nothing.
 *
 * Every transition is decided by `planTransition`, which is pure. This module
 * only reads rows, applies what it is told, and queues the mail.
 */

export type SweepSummary = {
  considered: number;
  warned: number;
  gracedStarted: number;
  frozen: number;
  /** Tenants with no reachable owner address, so nothing could be sent. */
  unreachable: number;
  errors: number;
};

/**
 * Billing mail must reach a human. `notification_email` is optional by design
 * (NULL means "do not send me booking alerts"), but that is a preference about
 * *bookings* — it cannot be read as consent to miss a notice that their page is
 * about to go offline. So it falls back to the account's own login address.
 */
async function resolveRecipients(
  db: Database,
  rows: { id: string; ownerUserId: string; notificationEmail: string | null }[],
): Promise<Map<string, string>> {
  const needsLookup = rows.filter((r) => !r.notificationEmail);
  const ownerEmails = await getOwnerEmails(
    db,
    needsLookup.map((r) => r.ownerUserId),
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    const email = row.notificationEmail ?? ownerEmails.get(row.ownerUserId);
    if (email) map.set(row.id, email);
  }
  return map;
}

export async function sweepSubscriptions(
  db: Database,
  { now = new Date() }: { now?: Date } = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = {
    considered: 0,
    warned: 0,
    gracedStarted: 0,
    frozen: 0,
    unreachable: 0,
    errors: 0,
  };

  // Only statuses the machine can act on, and only unfrozen tenants. An
  // `active` subscription has no clock running and a frozen one is already at
  // the end of the line.
  const candidates = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      ownerUserId: businesses.ownerUserId,
      notificationEmail: businesses.notificationEmail,
      subscriptionStatus: businesses.subscriptionStatus,
      trialEndsAt: businesses.trialEndsAt,
      graceStartedAt: businesses.graceStartedAt,
      isActive: businesses.isActive,
      frozenReason: businesses.frozenReason,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.isActive, true),
        inArray(businesses.subscriptionStatus, ["trialing", "past_due"]),
        or(
          isNotNull(businesses.trialEndsAt),
          isNotNull(businesses.graceStartedAt),
        ),
      ),
    );

  summary.considered = candidates.length;
  if (candidates.length === 0) return summary;

  const recipients = await resolveRecipients(db, candidates);

  for (const row of candidates) {
    const lifecycleRow: LifecycleRow = {
      id: row.id,
      // Normalised: the column is varchar, and a value written past the app
      // must not be able to steer a transition.
      subscriptionStatus: toSubscriptionStatus(row.subscriptionStatus),
      trialEndsAt: row.trialEndsAt,
      graceStartedAt: row.graceStartedAt,
      isActive: row.isActive,
      frozenReason: row.frozenReason,
    };

    const action = planTransition(lifecycleRow, now);
    if (action.type === "none") continue;

    const recipient = recipients.get(row.id);

    try {
      switch (action.type) {
        case "warn_trial": {
          if (!recipient) {
            summary.unreachable++;
            break;
          }
          const queued = await enqueueNotification(db, {
            businessId: row.id,
            channel: "email",
            kind: "trial_ending",
            recipient,
            scheduledFor: now,
            // One warning per threshold, ever. The unique dedupe key is what
            // makes the sweep safe to run twice in a day.
            dedupeKey: `trial_ending:${row.id}:${action.threshold}`,
          });
          if (queued) summary.warned++;
          break;
        }

        case "start_grace": {
          // Status and clock move together in one statement. Split across two,
          // a failure between them leaves a tenant past_due with no clock,
          // which `planTransition` deliberately refuses to act on — they would
          // sit in limbo, degraded but never frozen and never recovered.
          await db
            .update(businesses)
            .set({ subscriptionStatus: "past_due", graceStartedAt: now })
            .where(eq(businesses.id, row.id));

          summary.gracedStarted++;
          reportWarning("billing.sweep.grace", "trial lapsed, grace started", {
            businessId: row.id,
          });

          if (recipient) {
            await enqueueNotification(db, {
              businessId: row.id,
              channel: "email",
              kind: "trial_ended",
              recipient,
              scheduledFor: now,
              dedupeKey: `trial_ended:${row.id}`,
            });
          } else {
            summary.unreachable++;
          }
          break;
        }

        case "freeze": {
          await db
            .update(businesses)
            .set({ isActive: false, frozenReason: "billing" })
            .where(eq(businesses.id, row.id));

          summary.frozen++;
          // Same level as an admin freeze: this takes a tenant's public
          // booking page offline, and it happened without a human deciding.
          reportWarning(
            "billing.sweep.freeze",
            "tenant frozen for non-payment",
            {
              businessId: row.id,
            },
          );
          break;
        }
      }
    } catch (error) {
      summary.errors++;
      reportError("billing.sweep", error, {
        businessId: row.id,
        action: action.type,
      });
    }
  }

  return summary;
}
