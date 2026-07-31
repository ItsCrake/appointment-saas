import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { appointments, businesses, type AppointmentStatus } from "../schema";
import type { Database } from "../types";

/** Statuses that occupy a slot. Cancelled/no-show free the time again. */
export const BLOCKING_STATUSES = [
  "pending",
  "confirmed",
] as const satisfies readonly AppointmentStatus[];

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

export type DashboardStats = {
  /** Excludes cancelled — the owner cares about what is actually happening. */
  todayCount: number;
  weekCount: number;
  upcomingCount: number;
  /** Denominator for both rates: appointments whose start time has passed. */
  pastCount: number;
  cancelledCount: number;
  noShowCount: number;
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
    })
    .from(appointments)
    .where(eq(appointments.businessId, businessId));

  return (
    row ?? {
      todayCount: 0,
      weekCount: 0,
      upcomingCount: 0,
      pastCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
    }
  );
}

export type ClientSummary = {
  clientPhone: string;
  clientName: string;
  bookings: number;
  lastVisit: Date;
};

/**
 * Clients are not a table — they are derived from appointment history, keyed
 * by phone number (the identity a booking actually carries). The name shown is
 * the most recent one, since people re-book with slight spelling changes.
 */
export async function listClients(
  db: Database,
  businessId: string,
): Promise<ClientSummary[]> {
  const rows = await db
    .select({
      clientPhone: appointments.clientPhone,
      clientName: sql<string>`(array_agg(${appointments.clientName} ORDER BY ${appointments.startsAt} DESC))[1]`,
      bookings: sql<number>`count(*)::int`,
      lastVisit: sql<Date>`max(${appointments.startsAt})`,
    })
    .from(appointments)
    .where(eq(appointments.businessId, businessId))
    .groupBy(appointments.clientPhone)
    .orderBy(sql`max(${appointments.startsAt}) DESC`);

  return rows.map((row) => ({
    ...row,
    lastVisit: new Date(row.lastVisit),
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
