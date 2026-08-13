import { and, desc, eq, sql } from "drizzle-orm";

import { appointments, clientProfiles } from "../schema";
import type { Database } from "../types";

/**
 * The client record, keyed on `(business_id, client_phone)`.
 *
 * ---------------------------------------------------------------------------
 * **The phone number is the identity, and that is a decision the rest of the
 * product already made.** A booking carries one, `/[slug]/my-appointments`
 * searches by one, and the win-back campaign groups by one. Keying a profile on
 * the name instead would merge two different people called דני and split one
 * person who typed their own name two different ways — which is exactly the
 * duplication this is meant to prevent.
 *
 * Nothing here is scoped by anything but the tenant and the phone, so a note
 * written by one shop is invisible to every other.
 * ---------------------------------------------------------------------------
 */

export type ClientStats = {
  /** Every booking ever made, cancellations included. */
  total: number;
  /** Appointments that happened: past, and not cancelled or no-show. */
  completed: number;
  cancelled: number;
  noShow: number;
  /** Still ahead and not cancelled. */
  upcoming: number;
};

/**
 * The profile row, or null when the owner has never written one.
 *
 * Null rather than an empty profile: "no notes" and "notes that say nothing"
 * look identical on screen but differ in the database, and creating a row for
 * every client an owner merely *looked at* would fill the table with blanks.
 */
export async function getClientProfile(
  db: Database,
  businessId: string,
  clientPhone: string,
) {
  const [row] = await db
    .select()
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.businessId, businessId),
        eq(clientProfiles.clientPhone, clientPhone),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Every profile this tenant has written, as a phone → notes map.
 *
 * One query for a whole week of calendar entries. The alternative — a lookup
 * per appointment as each card renders — is a round trip per booking on a page
 * that already draws forty of them, to answer a question about a table that
 * holds one row per client the owner has bothered to annotate.
 */
export async function mapClientNotes(
  db: Database,
  businessId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      clientPhone: clientProfiles.clientPhone,
      notes: clientProfiles.notes,
    })
    .from(clientProfiles)
    .where(eq(clientProfiles.businessId, businessId));

  return new Map(
    rows
      .filter((row) => row.notes.trim().length > 0)
      .map((row) => [row.clientPhone, row.notes]),
  );
}

/**
 * Writes the note, creating the profile if this is the first one.
 *
 * An upsert on the unique key rather than a read-then-write: two tabs open on
 * the same client would otherwise both find nothing and both insert, and one of
 * them would lose to the constraint with a Postgres error the owner cannot act
 * on.
 *
 * Clearing the box deletes nothing — an empty string is a perfectly good answer
 * and keeping the row means the profile's `created_at` survives the owner
 * changing their mind twice.
 */
export async function upsertClientProfile(
  db: Database,
  businessId: string,
  clientPhone: string,
  notes: string,
) {
  const [row] = await db
    .insert(clientProfiles)
    .values({ businessId, clientPhone, notes })
    .onConflictDoUpdate({
      target: [clientProfiles.businessId, clientProfiles.clientPhone],
      set: { notes, updatedAt: new Date() },
    })
    .returning();

  return row;
}

/**
 * How this client has behaved, in one scan.
 *
 * `completed` counts what actually *happened* rather than the `completed`
 * status alone: a busy shop does not go back and tidy statuses, so a past
 * `confirmed` booking is a visit. The same rule the clients list uses for "last
 * visit", and the two would read as contradicting each other otherwise.
 */
export async function getClientStats(
  db: Database,
  businessId: string,
  clientPhone: string,
  now: Date = new Date(),
): Promise<ClientStats> {
  // ISO string with an explicit cast: a raw `Date` in a `sql` template has no
  // inferable type for postgres.js and throws at bind time.
  const at = sql`${now.toISOString()}::timestamptz`;

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) FILTER (
        WHERE ${appointments.status} NOT IN ('cancelled', 'no_show')
          AND ${appointments.startsAt} <= ${at}
      )::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'cancelled')::int`,
      noShow: sql<number>`count(*) FILTER (WHERE ${appointments.status} = 'no_show')::int`,
      upcoming: sql<number>`count(*) FILTER (
        WHERE ${appointments.status} <> 'cancelled'
          AND ${appointments.startsAt} > ${at}
      )::int`,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.clientPhone, clientPhone),
      ),
    );

  return (
    row ?? { total: 0, completed: 0, cancelled: 0, noShow: 0, upcoming: 0 }
  );
}

/** This client's bookings at this business, newest first. */
export async function listClientHistory(
  db: Database,
  businessId: string,
  clientPhone: string,
  limit = 50,
) {
  return db
    .select({
      id: appointments.id,
      clientName: appointments.clientName,
      startsAt: appointments.startsAt,
      status: appointments.status,
      serviceName: appointments.serviceName,
      priceCents: appointments.priceCents,
      notes: appointments.notes,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.clientPhone, clientPhone),
      ),
    )
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
}
