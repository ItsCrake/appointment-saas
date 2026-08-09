import { sql } from "drizzle-orm";

import { appointments, staff } from "../schema";
import type { Database } from "../types";

/**
 * Aggregates behind `/dashboard/analytics`.
 *
 * ---------------------------------------------------------------------------
 * Two rules run through every query here.
 *
 * **Wall clock, not UTC.** "Busiest hour" means the hour on the shop's wall,
 * so every date part is extracted from `starts_at AT TIME ZONE <business tz>`.
 * Reading the raw column would put a Tel Aviv shop's 09:00 rush at 06:00 in
 * winter and 07:00 in summer, and nobody would notice the number was wrong.
 *
 * **Cancelled rows are excluded from every "how busy were we" figure** and
 * counted only in the status breakdown, which is the one question that is
 * about them. A cancelled appointment occupied no chair and earned nothing;
 * including it would inflate exactly the numbers an owner uses to decide when
 * to open.
 *
 * Timestamps are bound as ISO strings with an explicit cast. A raw `Date`
 * inside a Drizzle `sql` template has no inferable type for the postgres.js
 * driver and throws at bind time — it passes in PGlite, which is how it
 * reached production once already.
 * ---------------------------------------------------------------------------
 */

type Window = { from: Date; to: Date };

const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** Local wall-clock timestamp for the business, as a SQL fragment. */
const local = (timezone: string) =>
  sql`(${appointments.startsAt} AT TIME ZONE ${timezone})`;

/** Every "how busy" figure ignores cancellations. */
const live = sql`${appointments.status} <> 'cancelled'`;

function inWindow(businessId: string, window: Window) {
  return sql`${appointments.businessId} = ${businessId}
    AND ${appointments.startsAt} >= ${at(window.from)}
    AND ${appointments.startsAt} < ${at(window.to)}`;
}

export type HeatCell = { weekday: number; hour: number; bookings: number };

/**
 * Bookings per (weekday, hour) in the shop's own timezone.
 *
 * Sparse on purpose — only cells with bookings come back. The grid is 7 × 24
 * and a shop open six hours a day fills a tenth of it; sending 168 rows of
 * mostly zeroes to render a heatmap is work for both ends.
 */
export async function getPeakHeatmap(
  db: Database,
  businessId: string,
  timezone: string,
  window: Window,
): Promise<HeatCell[]> {
  const rows = await db
    .select({
      weekday: sql<number>`EXTRACT(DOW FROM ${local(timezone)})::int`,
      hour: sql<number>`EXTRACT(HOUR FROM ${local(timezone)})::int`,
      bookings: sql<number>`count(*)::int`,
    })
    .from(appointments)
    .where(sql`${inWindow(businessId, window)} AND ${live}`)
    // Ordinals, not the expression repeated.
    //
    // The timezone is a bound parameter, so writing the same expression twice
    // emits `$1` in the select and `$5` in the group by — and Postgres matches
    // grouping expressions *syntactically*, so it sees two different things and
    // rejects the query with "must appear in the GROUP BY clause". Referring to
    // the select position sidesteps the whole question.
    .groupBy(sql`1`, sql`2`);

  return rows;
}

export type ServiceBreakdown = {
  serviceName: string;
  bookings: number;
  revenueCents: number;
};

/**
 * Grouped by the **snapshotted** `service_name`, not by `service_id`.
 *
 * That is what an owner means by "which service": a renamed or deleted service
 * still has history, and joining the live table would either drop those rows or
 * relabel last quarter under this quarter's name.
 */
export async function getServiceBreakdown(
  db: Database,
  businessId: string,
  window: Window,
): Promise<ServiceBreakdown[]> {
  return db
    .select({
      serviceName: appointments.serviceName,
      bookings: sql<number>`count(*)::int`,
      revenueCents: sql<number>`coalesce(sum(${appointments.priceCents}), 0)::int`,
    })
    .from(appointments)
    .where(sql`${inWindow(businessId, window)} AND ${live}`)
    .groupBy(appointments.serviceName)
    .orderBy(sql`count(*) DESC`);
}

export type StatusCount = { status: string; bookings: number };

/** The one place cancellations count — it is the question they answer. */
export async function getStatusBreakdown(
  db: Database,
  businessId: string,
  window: Window,
): Promise<StatusCount[]> {
  return db
    .select({
      status: appointments.status,
      bookings: sql<number>`count(*)::int`,
    })
    .from(appointments)
    .where(inWindow(businessId, window))
    .groupBy(appointments.status)
    .orderBy(sql`count(*) DESC`);
}

export type StaffLoad = {
  staffId: string;
  staffName: string;
  color: string;
  bookings: number;
  revenueCents: number;
};

/**
 * Bookings per provider.
 *
 * An inner join on `staff`, unlike the client lookup: a row with no provider
 * cannot exist (`staff_id` is NOT NULL with ON DELETE RESTRICT), and a
 * "Unknown" bucket in a utilisation chart is a distraction rather than a
 * finding.
 */
export async function getStaffLoad(
  db: Database,
  businessId: string,
  window: Window,
): Promise<StaffLoad[]> {
  return db
    .select({
      staffId: staff.id,
      staffName: staff.name,
      color: staff.color,
      bookings: sql<number>`count(*)::int`,
      revenueCents: sql<number>`coalesce(sum(${appointments.priceCents}), 0)::int`,
    })
    .from(appointments)
    .innerJoin(staff, sql`${staff.id} = ${appointments.staffId}`)
    .where(sql`${inWindow(businessId, window)} AND ${live}`)
    .groupBy(staff.id, staff.name, staff.color)
    .orderBy(sql`count(*) DESC`);
}

export type TrendPoint = {
  /** "YYYY-MM-DD" — the first day of the bucket, in the business timezone. */
  period: string;
  bookings: number;
  revenueCents: number;
};

export type Granularity = "week" | "month";

/**
 * Bookings and expected revenue over time.
 *
 * Weeks start on **Sunday**, which is the Israeli week. Postgres'
 * `date_trunc('week', …)` starts on Monday, so the timestamp is shifted a day
 * forward before truncating and a day back after — without it, every Sunday
 * would be filed under the previous week and the busiest day of the week would
 * land in the wrong bar.
 */
export async function getBookingTrend(
  db: Database,
  businessId: string,
  timezone: string,
  window: Window,
  granularity: Granularity,
): Promise<TrendPoint[]> {
  const bucket =
    granularity === "week"
      ? sql`(date_trunc('week', ${local(timezone)} + interval '1 day') - interval '1 day')`
      : sql`date_trunc('month', ${local(timezone)})`;

  return (
    db
      .select({
        period: sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`,
        bookings: sql<number>`count(*)::int`,
        revenueCents: sql<number>`coalesce(sum(${appointments.priceCents}), 0)::int`,
      })
      .from(appointments)
      .where(sql`${inWindow(businessId, window)} AND ${live}`)
      // By position, for the bound-parameter reason explained in `getPeakHeatmap`.
      // Ordering by the formatted string is safe because `YYYY-MM-DD` sorts
      // lexicographically exactly as it sorts chronologically.
      .groupBy(sql`1`)
      .orderBy(sql`1`)
  );
}
