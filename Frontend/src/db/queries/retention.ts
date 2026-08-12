import { and, asc, desc, eq, gte, lt, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { appointments, marketingOptOuts } from "../schema";
import type { Database } from "../types";

/**
 * Who a business may send a win-back message to.
 *
 * ---------------------------------------------------------------------------
 * Every filter here is a gate that must hold, not a heuristic that improves
 * targeting. This is the only marketing message the product sends, so a client
 * who slips through one of these receives a commercial approach they never
 * agreed to, from a business whose own WhatsApp number takes the complaint.
 *
 * Timestamps are bound as ISO strings with an explicit cast, for the reason
 * `analytics.ts` documents: a raw `Date` inside a Drizzle `sql` template has no
 * inferable type for the postgres.js driver and throws at bind time, while
 * passing cleanly in PGlite.
 * ---------------------------------------------------------------------------
 */

export type WinBackCandidate = {
  phone: string;
  name: string;
  /**
   * The visit that lapsed. It is the dedupe key's payload, which is what makes
   * a win-back a once-per-lapse event rather than a daily one.
   */
  appointmentId: string;
  lastVisit: Date;
};

export async function listWinBackCandidates(
  db: Database,
  businessId: string,
  {
    now,
    inactiveDays,
    limit,
  }: { now: Date; inactiveDays: number; limit: number },
): Promise<WinBackCandidate[]> {
  const cutoff = new Date(now.getTime() - inactiveDays * 86_400_000);
  const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;

  /**
   * One row per client: their most recent booking that was not cancelled.
   *
   * `DISTINCT ON` rather than a `GROUP BY` with a join back, because the whole
   * row is wanted — and specifically because the consent flag must come from
   * the **latest** booking. A `max(starts_at)` with a separate consent lookup
   * would let an older ticked box resurrect a consent the client has since
   * stopped giving by leaving it unticked.
   *
   * Built through the query builder rather than `db.execute()`, following
   * `countNewClients`: the shared `Database` handle is driver-agnostic, so
   * `execute()` comes back untyped and each driver wraps rows differently.
   */
  const latest = db
    .selectDistinctOn([appointments.clientPhone], {
      phone: appointments.clientPhone,
      name: appointments.clientName,
      appointmentId: appointments.id,
      lastVisit: appointments.startsAt,
      consented: appointments.clientConsentedMarketing,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        // Someone whose only booking was cancelled never became a customer.
        ne(appointments.status, "cancelled"),
      ),
    )
    .orderBy(appointments.clientPhone, desc(appointments.startsAt))
    .as("latest");

  const upcoming = alias(appointments, "upcoming");

  const rows = await db
    .select({
      phone: latest.phone,
      name: latest.name,
      appointmentId: latest.appointmentId,
      lastVisit: latest.lastVisit,
    })
    .from(latest)
    .where(
      and(
        eq(latest.consented, true),
        lt(latest.lastVisit, at(cutoff)),
        /**
         * Nothing on the calendar. Without this the message reaches someone
         * who booked last week for next month — "we miss you" to a client who
         * is already coming reads as a shop that does not know its customers.
         */
        notExists(
          db
            .select({ one: sql`1` })
            .from(upcoming)
            .where(
              and(
                eq(upcoming.businessId, businessId),
                eq(upcoming.clientPhone, latest.phone),
                gte(upcoming.startsAt, at(now)),
                ne(upcoming.status, "cancelled"),
              ),
            ),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(marketingOptOuts)
            .where(
              and(
                eq(marketingOptOuts.businessId, businessId),
                eq(marketingOptOuts.clientPhone, latest.phone),
              ),
            ),
        ),
      ),
    )
    // Longest-lapsed first, so a capped run drains the backlog in a stable
    // order instead of re-offering whoever happens to sort first by phone.
    .orderBy(asc(latest.lastVisit))
    .limit(limit);

  return rows.map((row) => ({
    phone: row.phone,
    name: row.name,
    appointmentId: row.appointmentId,
    lastVisit: row.lastVisit,
  }));
}

/**
 * Suppresses one client for one business. Idempotent: an owner acting on a
 * second "הסר" reply should not see an error for doing the right thing twice.
 */
export async function addMarketingOptOut(
  db: Database,
  businessId: string,
  clientPhone: string,
  reason?: string,
) {
  await db
    .insert(marketingOptOuts)
    .values({ businessId, clientPhone, reason: reason ?? null })
    .onConflictDoNothing();
}

export async function removeMarketingOptOut(
  db: Database,
  businessId: string,
  clientPhone: string,
) {
  await db
    .delete(marketingOptOuts)
    .where(
      and(
        eq(marketingOptOuts.businessId, businessId),
        eq(marketingOptOuts.clientPhone, clientPhone),
      ),
    );
}

export async function listMarketingOptOuts(db: Database, businessId: string) {
  return db
    .select()
    .from(marketingOptOuts)
    .where(eq(marketingOptOuts.businessId, businessId));
}
