import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

import {
  appointments,
  appointmentStatus,
  businesses,
  staff,
  TERMINAL_STATUSES,
  type AppointmentStatus,
} from "../schema";
import type { Database } from "../types";

/**
 * Statuses that occupy a slot. Cancelled, completed and no-show free the time.
 *
 * **Derived, not listed.** This has to agree exactly with the exclusion
 * constraint's predicate, and 0013 states that predicate as "not one of the
 * terminal statuses" so it could cover the deposit statuses 0014 adds without
 * naming them. Writing this list out by hand would mean availability ignoring a
 * `pending_deposit` appointment that the database still blocks — the UI would
 * offer a slot and the insert would then refuse it, which is the worst of both.
 */
export const BLOCKING_STATUSES = appointmentStatus.enumValues.filter(
  (status): status is AppointmentStatus =>
    !(TERMINAL_STATUSES as readonly string[]).includes(status),
);

/**
 * Appointments overlapping [from, to). An appointment that starts before the
 * window but runs into it still blocks, so the lower bound is on endsAt.
 */
export async function listAppointmentsInRange(
  db: Database,
  businessId: string,
  from: Date,
  to: Date,
  statuses: readonly AppointmentStatus[] = BLOCKING_STATUSES,
) {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        lt(appointments.startsAt, to),
        gt(appointments.endsAt, from),
        inArray(appointments.status, [...statuses]),
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

/** One appointment, tenant-scoped so another shop's id simply does not resolve. */
export async function getAppointment(
  db: Database,
  businessId: string,
  appointmentId: string,
) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Dashboard action: mark completed / no-show / cancelled, tenant-scoped. */
export async function updateAppointmentStatus(
  db: Database,
  businessId: string,
  appointmentId: string,
  status: AppointmentStatus,
) {
  const [row] = await db
    .update(appointments)
    .set({ status })
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.id, appointmentId),
      ),
    )
    .returning();

  return row ?? null;
}

/** Raised when the DB exclusion constraint rejects an overlapping insert. */
export class SlotTakenError extends Error {
  constructor() {
    super("SLOT_TAKEN");
    this.name = "SlotTakenError";
  }
}

/** Postgres exclusion-constraint violation, wrapped by Drizzle in `cause`. */
function isOverlapViolation(error: unknown): boolean {
  return /appointments_no_overlap/.test(
    String((error as { cause?: unknown })?.cause ?? error),
  );
}

/**
 * Inserts a booking, translating the double-booking constraint into a typed
 * error. This is the race-condition backstop: two clients can both pass the
 * availability check, and only one insert survives.
 */
export async function createAppointment(
  db: Database,
  values: typeof appointments.$inferInsert,
) {
  try {
    const [row] = await db.insert(appointments).values(values).returning();
    return row;
  } catch (error) {
    if (isOverlapViolation(error)) throw new SlotTakenError();
    throw error;
  }
}

/**
 * The soonest appointment still ahead. The agenda opens on today, so without
 * this an owner whose only bookings are days away sees an empty day and
 * reasonably concludes the booking was lost.
 */
export async function getNextUpcomingAppointment(
  db: Database,
  businessId: string,
  now: Date,
) {
  const [row] = await db
    .select()
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
 * Requests still waiting on the owner, soonest first.
 *
 * Its own query rather than a filter over the agenda's range, because the
 * agenda shows **one day** and a request can be for any day. An owner who has
 * to find next Tuesday's request by navigating to next Tuesday will not find
 * it, and the client is left waiting on an answer that never comes.
 *
 * Past requests are excluded: approving a time that has already gone is not a
 * decision anyone needs offered.
 */
export async function listPendingRequests(
  db: Database,
  businessId: string,
  now: Date,
) {
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.status, "pending"),
        gt(appointments.startsAt, now),
      ),
    )
    .orderBy(asc(appointments.startsAt));
}

export type DashboardStats = {
  /** Excludes cancelled — the owner cares about what is actually happening. */
  todayCount: number;
  weekCount: number;
  upcomingCount: number;
  /** Denominator for both rates: appointments whose start time has passed. */
  pastCount: number;
  cancelledCount: number;
  noShowCount: number;
  /** Sum of today's non-cancelled prices, in agorot. Expected, not collected. */
  todayRevenueCents: number;
  /** Phones whose first-ever booking falls inside this week. */
  newClientsThisWeek: number;
};

/**
 * One round trip for every headline number, using FILTER so each metric gets
 * its own predicate over a single scan.
 *
 * Both rates are measured only against appointments that have already started:
 * counting future bookings in the denominator would make a busy week look like
 * an improvement in no-shows.
 */
export async function getDashboardStats(
  db: Database,
  businessId: string,
  windows: {
    todayStart: Date;
    todayEnd: Date;
    weekStart: Date;
    weekEnd: Date;
    ratesFrom: Date;
    now: Date;
  },
): Promise<DashboardStats> {
  const { todayStart, todayEnd, weekStart, weekEnd, ratesFrom, now } = windows;

  // Bind timestamps as ISO strings with an explicit cast: a raw Date inside a
  // `sql` template has no inferable type for the postgres.js driver, which
  // fails at bind time even though PGlite accepts it.
  const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;

  const live = sql`${appointments.status} <> 'cancelled'`;
  const inRatesWindow = sql`${appointments.startsAt} >= ${at(ratesFrom)} AND ${appointments.startsAt} < ${at(now)}`;

  const [row] = await db
    .select({
      todayCount: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${at(todayStart)} AND ${appointments.startsAt} < ${at(todayEnd)} AND ${live})::int`,
      weekCount: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${at(weekStart)} AND ${appointments.startsAt} < ${at(weekEnd)} AND ${live})::int`,
      upcomingCount: sql<number>`count(*) FILTER (WHERE ${appointments.startsAt} >= ${at(now)} AND ${live})::int`,
      pastCount: sql<number>`count(*) FILTER (WHERE ${inRatesWindow})::int`,
      cancelledCount: sql<number>`count(*) FILTER (WHERE ${inRatesWindow} AND ${appointments.status} = 'cancelled')::int`,
      noShowCount: sql<number>`count(*) FILTER (WHERE ${inRatesWindow} AND ${appointments.status} = 'no_show')::int`,
      // coalesce: sum() over an empty filter is NULL, not 0.
      todayRevenueCents: sql<number>`coalesce(sum(${appointments.priceCents}) FILTER (WHERE ${appointments.startsAt} >= ${at(todayStart)} AND ${appointments.startsAt} < ${at(todayEnd)} AND ${live}), 0)::int`,
    })
    .from(appointments)
    .where(eq(appointments.businessId, businessId));

  const newClientsThisWeek = await countNewClients(db, businessId, {
    from: weekStart,
    to: weekEnd,
  });

  return {
    ...(row ?? {
      todayCount: 0,
      weekCount: 0,
      upcomingCount: 0,
      pastCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
      todayRevenueCents: 0,
    }),
    newClientsThisWeek,
  };
}

/**
 * Clients whose *first* booking falls in the window — not merely everyone who
 * booked in it, which would count regulars as new every time they return.
 *
 * Its own query rather than another FILTER on the aggregate above: this groups
 * by phone and the others count rows, so they cannot share a scan.
 */
export async function countNewClients(
  db: Database,
  businessId: string,
  window: { from: Date; to: Date },
): Promise<number> {
  // Same ISO-string cast as the aggregate above: a raw Date inside a `sql`
  // template has no inferable type for the postgres.js driver.
  const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;

  // Built through the query builder rather than db.execute(): the shared
  // Database handle is driver-agnostic, so execute() returns an untyped result.
  const firstBookings = db
    .select({ phone: appointments.clientPhone })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        ne(appointments.status, "cancelled"),
      ),
    )
    .groupBy(appointments.clientPhone)
    .having(
      sql`min(${appointments.startsAt}) >= ${at(window.from)} AND min(${appointments.startsAt}) < ${at(window.to)}`,
    )
    .as("first_bookings");

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(firstBookings);

  return row?.count ?? 0;
}

/**
 * One client's history at one business, newest first, with the provider's name.
 *
 * Scoped by `businessId` **and** phone, never by phone alone: a client who
 * books at two shops on this platform must not see one shop's list from the
 * other's page. The phone is matched against the normalised form, which is what
 * `createBookingAction` stores.
 *
 * A left join on staff, because `staff_id` is NOT NULL but the row could in
 * principle be missing; the page renders "—" rather than nothing.
 */
export async function listAppointmentsForClient(
  db: Database,
  businessId: string,
  clientPhone: string,
  limit = 60,
) {
  return db
    .select({ appointment: appointments, staffName: staff.name })
    .from(appointments)
    .leftJoin(staff, eq(appointments.staffId, staff.id))
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.clientPhone, clientPhone),
      ),
    )
    .orderBy(desc(appointments.startsAt))
    .limit(limit);
}

export type ClientSummary = {
  clientPhone: string;
  clientName: string;
  bookings: number;
  /**
   * **Null when they have never actually been in** — someone whose only
   * bookings were cancelled, or whose first appointment is still ahead of
   * them. Both are real states and neither is a visit, so the column has to be
   * able to say "none" rather than borrowing the nearest date it can find.
   */
  lastVisit: Date | null;
};

/**
 * Clients are not a table — they are derived from appointment history, keyed
 * by phone number (the identity a booking actually carries). The name shown is
 * the most recent one, since people re-book with slight spelling changes.
 *
 * **"Last visit" counts only appointments that happened.** It used to be a
 * plain `max(starts_at)` over every row, which was wrong in two directions at
 * once and wrong in a way that looked plausible:
 *
 * - a client who **cancelled** last Tuesday showed last Tuesday as their last
 *   visit, so a shop chasing lapsed regulars saw someone who had not been in
 *   for months as freshly seen;
 * - a client with a **future** booking showed a date that has not happened yet,
 *   which is how a "last visit" column ends up printing next month.
 *
 * `no_show` is excluded for the same reason as `cancelled`: the chair sat
 * empty. `pending` and `confirmed` in the past are kept — the appointment ran
 * even if nobody moved the status afterwards, which is the normal state of a
 * busy shop's calendar.
 *
 * `bookings` deliberately still counts everything. It is labelled "תורים" and
 * answers a different question — how much this person has ever booked, which
 * includes the times they cancelled.
 */
export async function listClients(
  db: Database,
  businessId: string,
  now: Date = new Date(),
): Promise<ClientSummary[]> {
  // Bound as an ISO string with an explicit cast: a raw `Date` inside a `sql`
  // template has no inferable type for the postgres.js driver and throws at
  // bind time, while passing cleanly in PGlite. See `analytics.ts`.
  const visited = sql`${appointments.status} NOT IN ('cancelled', 'no_show')
    AND ${appointments.startsAt} <= ${now.toISOString()}::timestamptz`;

  const rows = await db
    .select({
      clientPhone: appointments.clientPhone,
      clientName: sql<string>`(array_agg(${appointments.clientName} ORDER BY ${appointments.startsAt} DESC))[1]`,
      bookings: sql<number>`count(*)::int`,
      lastVisit: sql<Date | null>`max(${appointments.startsAt}) FILTER (WHERE ${visited})`,
    })
    .from(appointments)
    .where(eq(appointments.businessId, businessId))
    .groupBy(appointments.clientPhone)
    // NULLS LAST explicitly: Postgres sorts nulls *first* under DESC, which
    // would put every client who has never been in at the top of the list.
    .orderBy(
      sql`max(${appointments.startsAt}) FILTER (WHERE ${visited}) DESC NULLS LAST`,
    );

  return rows.map((row) => ({
    ...row,
    lastVisit: row.lastVisit ? new Date(row.lastVisit) : null,
  }));
}

export async function getAppointmentByCancelToken(
  db: Database,
  cancelToken: string,
) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.cancelToken, cancelToken))
    .limit(1);

  return row ?? null;
}

/**
 * The self-service page needs the business (timezone, cancel window, contact)
 * alongside the appointment, so fetch them in one round trip.
 */
export async function getAppointmentContextByToken(
  db: Database,
  cancelToken: string,
) {
  const [row] = await db
    .select({ appointment: appointments, business: businesses })
    .from(appointments)
    .innerJoin(businesses, eq(appointments.businessId, businesses.id))
    .where(eq(appointments.cancelToken, cancelToken))
    .limit(1);

  return row ?? null;
}

/**
 * Cancelling only flips the status: the row stays for history, and the
 * exclusion constraint's partial index stops counting it, which frees the slot
 * immediately.
 */
export async function cancelAppointmentByToken(
  db: Database,
  cancelToken: string,
) {
  const [row] = await db
    .update(appointments)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(appointments.cancelToken, cancelToken),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
      ),
    )
    .returning();

  return row ?? null;
}
