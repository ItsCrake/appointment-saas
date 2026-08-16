import type { Business } from "@/db/schema";
import type { Database } from "@/db/types";
import { listWinBackCandidates } from "@/db/queries/retention";
import { listRetentionBusinesses } from "@/db/queries/businesses";
import { entitlementsFor } from "@/lib/entitlements";
import { isChannelLive } from "@/lib/notifications/providers";
import { enqueueWinBack } from "@/lib/notifications/enqueue";
import { reportError } from "@/lib/observability";

/**
 * Client win-back — the one marketing message this product sends.
 *
 * ---------------------------------------------------------------------------
 * Everything else in the outbox is *about an appointment the client made*: a
 * confirmation, a reminder, a cancellation. This is a commercial approach to
 * somebody who is not currently a customer, which under
 * סעיף 30א לחוק התקשורת is דבר פרסומת and needs prior explicit consent, an
 * identifiable sender and a working way out.
 *
 * So it is gated four times over, and no single gate is the feature switch:
 *
 * | Gate                     | Who decides       | Where                        |
 * | ------------------------ | ----------------- | ---------------------------- |
 * | `clientRetention`        | the plan          | `entitlements.ts`            |
 * | `retention_enabled`      | the owner         | `/dashboard/settings`        |
 * | `client_consented_...`   | the client        | the booking form             |
 * | `marketing_opt_outs`     | the client, later | the opt-out line's promise   |
 *
 * The order matters for cost, not for correctness: the cheap in-memory checks
 * run before the query that walks a tenant's booking history.
 * ---------------------------------------------------------------------------
 */

/**
 * How quiet a client has to go before they count as lapsed.
 *
 * A constant rather than a column, matching `DEFAULT_REMINDER_RULES`: making it
 * per-tenant needs a settings control and a migration, and there is no evidence
 * yet that any shop wants a different number. Three weeks is roughly a haircut
 * cycle — long enough that a regular has genuinely slipped, short enough that
 * the shop is still the one they think of.
 */
export const INACTIVE_DAYS = 21;

/**
 * The most win-backs one tenant may queue in a single run.
 *
 * A shop switching this on for the first time has years of history behind it,
 * and every lapsed client becomes eligible on the same morning. Without a cap
 * the first run is a bulk send — which is what the law and WhatsApp both treat
 * as spam, and the fastest way to get a tenant's own number blocked. The
 * backlog drains over subsequent days, longest-lapsed first.
 */
export const MAX_PER_RUN = 25;

export type RetentionSummary = {
  businessesConsidered: number;
  queued: number;
  /** Tenants skipped, by reason — surfaced in the cron response. */
  skipped: Record<string, number>;
};

function skip(summary: RetentionSummary, reason: string) {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}

/**
 * Whether a tenant may send win-backs at all, before any client is looked at.
 *
 * Pure and exported so the reasons are testable one at a time — the expensive
 * part of getting this wrong is that it is invisible: a tenant who should not
 * be sending simply sends, and nobody finds out until a client complains.
 */
export function retentionBlockedReason(business: Business): string | null {
  if (!business.retentionEnabled) return "not enabled";
  /**
   * Frozen is checked **before** the entitlement, and the order is load-bearing
   * now that a freeze resolves `effectivePlan` to `free`.
   *
   * Both are true of a frozen tenant, so whichever runs first is the reason
   * that gets logged and counted in the sweep summary. "frozen" is the more
   * specific and the more actionable of the two — "not entitled" would send
   * somebody looking at a plan that is fine.
   */
  if (!business.isActive) return "frozen";
  if (!entitlementsFor(business).clientRetention) return "not entitled";

  /**
   * WhatsApp specifically, with no fallback to email or SMS.
   *
   * An unconfigured channel resolves to the console provider, which logs the
   * message and reports success — for a reminder that is a recoverable
   * annoyance, but here it would mean a tenant believing their retention
   * campaign is running while nothing has ever been delivered. Falling back to
   * email instead would be a different product decision made silently on the
   * owner's behalf.
   */
  if (!isChannelLive("whatsapp")) return "whatsapp not configured";

  return null;
}

/**
 * Queues win-back messages for every tenant that has opted in.
 *
 * Rides the daily notifications cron beside the billing sweep, and for the same
 * reason: this is a question about days, not minutes, and a second entry point
 * would be a second thing to schedule and forget. It runs *before* dispatch so
 * a message queued this run goes out this run rather than tomorrow.
 *
 * One tenant's failure never stops the others — the loop reports and continues.
 * A retention message is the least important thing in this cron run, and it
 * must not be able to prevent a booking confirmation from being dispatched.
 */
export async function runRetentionSweep(
  db: Database,
  { now = new Date(), inactiveDays = INACTIVE_DAYS } = {},
): Promise<RetentionSummary> {
  const summary: RetentionSummary = {
    businessesConsidered: 0,
    queued: 0,
    skipped: {},
  };

  const businesses = await listRetentionBusinesses(db);
  summary.businessesConsidered = businesses.length;

  for (const business of businesses) {
    const blocked = retentionBlockedReason(business);
    if (blocked) {
      skip(summary, blocked);
      continue;
    }

    try {
      const candidates = await listWinBackCandidates(db, business.id, {
        now,
        inactiveDays,
        limit: MAX_PER_RUN,
      });

      for (const candidate of candidates) {
        const queued = await enqueueWinBack({
          db,
          business,
          candidate,
          now,
        });
        if (queued) summary.queued += 1;
      }
    } catch (error) {
      reportError("retention.sweep", error, { businessId: business.id });
      skip(summary, "error");
    }
  }

  return summary;
}
