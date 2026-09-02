import { and, asc, count, eq, gt, gte, ilike, inArray, lt } from "drizzle-orm";

import { appointments, businesses } from "../schema";
import type { Database } from "../types";
import { BLOCKING_STATUSES } from "./appointments";

/**
 * The Siri endpoint's data layer.
 *
 * ---------------------------------------------------------------------------
 * Kept apart from `queries/appointments.ts` because these have a constraint
 * nothing else here does: **an answer has to be spoken within a Siri turn**.
 * That rules out the pattern the dashboard uses — fetch the day, count in
 * JavaScript — in favour of counting in Postgres and selecting only the four
 * columns a sentence needs.
 *
 * Every one of these is a single indexed query, and none returns a whole row:
 * a spoken summary needs a time, a name and a service, and shipping the rest of
 * an appointment — its tokens, its notes, its price — across the wire to
 * discard it is both slower and a wider blast radius for a credential that
 * lives in somebody's Shortcut.
 * ---------------------------------------------------------------------------
 */

/** Just enough for a sentence. Deliberately not the whole row. */
const SPOKEN_COLUMNS = {
  startsAt: appointments.startsAt,
  clientName: appointments.clientName,
  serviceName: appointments.serviceName,
} as const;

/**
 * The business a token belongs to, or null.
 *
 * The **only** way this endpoint learns whose calendar it is answering about —
 * nothing is taken from the request body or a path segment, so a valid token
 * cannot be pointed at another tenant. Selects an explicit column list rather
 * than the bare `.select()` the rest of the codebase uses on `businesses`: this
 * runs on every Siri turn and has no use for forty columns of branding.
 */
export async function getBusinessBySiriToken(db: Database, token: string) {
  const [row] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      timezone: businesses.timezone,
      isActive: businesses.isActive,
    })
    .from(businesses)
    .where(eq(businesses.siriApiToken, token))
    .limit(1);

  return row ?? null;
}

/** Mints or replaces the token. Returns what was stored, for display once. */
export async function setSiriToken(
  db: Database,
  businessId: string,
  token: string | null,
) {
  const [row] = await db
    .update(businesses)
    .set({
      siriApiToken: token,
      // Cleared with the token, so a revoked integration does not keep a date
      // implying one is still live.
      siriTokenCreatedAt: token ? new Date() : null,
    })
    .where(eq(businesses.id, businessId))
    .returning({
      token: businesses.siriApiToken,
      createdAt: businesses.siriTokenCreatedAt,
    });

  return row ?? null;
}

/**
 * The next appointment from `now`, unbounded by day.
 *
 * Deliberately not limited to today — see `spokenNext`. An owner asking at
 * seven in the evening wants to hear about tomorrow morning, not "nothing else
 * today".
 */
export async function nextAppointment(
  db: Database,
  businessId: string,
  now: Date,
) {
  const [row] = await db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        gt(appointments.startsAt, now),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1);

  return row ?? null;
}

/**
 * How many bookings the shop's day holds, and which is next within it.
 *
 * One round trip for the count and one for the next, rather than fetching the
 * day and measuring it here. On a busy shop that is the difference between
 * moving one integer and moving forty rows so that `.length` can be read off
 * them.
 *
 * The window is passed in already resolved to UTC instants, because "today"
 * is a question about the *shop's* timezone and this layer must not guess it.
 */
export async function todaySummary(
  db: Database,
  businessId: string,
  dayStart: Date,
  dayEnd: Date,
  now: Date,
) {
  const scope = and(
    eq(appointments.businessId, businessId),
    gte(appointments.startsAt, dayStart),
    lt(appointments.startsAt, dayEnd),
    inArray(appointments.status, [...BLOCKING_STATUSES]),
  );

  const [[totals], [next]] = await Promise.all([
    db.select({ total: count() }).from(appointments).where(scope),
    db
      .select(SPOKEN_COLUMNS)
      .from(appointments)
      .where(and(scope, gt(appointments.startsAt, now)))
      .orderBy(asc(appointments.startsAt))
      .limit(1),
  ]);

  return { total: totals?.total ?? 0, next: next ?? null };
}

/**
 * Upcoming bookings whose client name contains the query.
 *
 * `ilike` with the term escaped: a name arriving from dictation can contain
 * `%` or `_`, and unescaped those turn a search for one client into a match on
 * every client. Capped at five because the caller names the first and counts
 * the rest — nobody retains a spoken list longer than that.
 */
export async function searchUpcomingByClient(
  db: Database,
  businessId: string,
  query: string,
  now: Date,
  limit = 5,
) {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);

  return db
    .select(SPOKEN_COLUMNS)
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        gt(appointments.startsAt, now),
        ilike(appointments.clientName, `%${escaped}%`),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(limit);
}
