import { and, asc, eq, inArray } from "drizzle-orm";

import { staff, staffSchedules } from "../schema";
import type { Database } from "../types";

/**
 * Staff who can take a booking, in display order.
 *
 * `sortOrder` then `createdAt` then `id`: the first two are the owner's
 * intent, and the id is there so the order is *total*. It has to be, because
 * "auto-select when only one is free" and the default pick in the dashboard
 * both read position 0 — an unstable order would move a walk-in between
 * providers on a page refresh.
 */
export async function listActiveStaff(db: Database, businessId: string) {
  return db
    .select()
    .from(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.isActive, true)))
    .orderBy(asc(staff.sortOrder), asc(staff.createdAt), asc(staff.id));
}

/** Every staff row including deactivated ones, for the dashboard manager. */
export async function listAllStaff(db: Database, businessId: string) {
  return db
    .select()
    .from(staff)
    .where(eq(staff.businessId, businessId))
    .orderBy(asc(staff.sortOrder), asc(staff.createdAt), asc(staff.id));
}

export async function getStaff(
  db: Database,
  businessId: string,
  staffId: string,
) {
  const [row] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.id, staffId)))
    .limit(1);

  return row ?? null;
}

/**
 * The staff member a booking goes to when the tenant is single-staff.
 *
 * Never null in practice — 0013 backfilled one per business and business
 * creation writes one — but the caller still has to handle null, because a row
 * deactivated by hand could otherwise leave a tenant unable to take bookings
 * with no explanation.
 */
export async function getDefaultStaff(db: Database, businessId: string) {
  const [row] = await listActiveStaff(db, businessId);
  return row ?? null;
}

/**
 * Schedules for one weekday, for the given staff.
 *
 * Returned flat rather than grouped: the caller groups by `staffId`, and a
 * staff member with *no* rows here is not missing from the result by accident —
 * that absence is meaningful, and means "inherit the business hours".
 */
export async function listStaffSchedulesForWeekday(
  db: Database,
  staffIds: string[],
  weekday: number,
) {
  if (staffIds.length === 0) return [];

  return db
    .select()
    .from(staffSchedules)
    .where(
      and(
        inArray(staffSchedules.staffId, staffIds),
        eq(staffSchedules.weekday, weekday),
      ),
    )
    .orderBy(asc(staffSchedules.startTime));
}

export async function listSchedulesForStaff(db: Database, staffId: string) {
  return db
    .select()
    .from(staffSchedules)
    .where(eq(staffSchedules.staffId, staffId))
    .orderBy(asc(staffSchedules.weekday), asc(staffSchedules.startTime));
}

export async function createStaff(
  db: Database,
  values: { businessId: string; name: string; title?: string | null },
) {
  const [row] = await db
    .insert(staff)
    .values({
      businessId: values.businessId,
      name: values.name,
      title: values.title ?? null,
    })
    .returning();

  return row;
}

export async function updateStaff(
  db: Database,
  businessId: string,
  staffId: string,
  patch: {
    name?: string;
    title?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  },
) {
  const [row] = await db
    .update(staff)
    .set(patch)
    .where(and(eq(staff.businessId, businessId), eq(staff.id, staffId)))
    .returning();

  return row ?? null;
}

/** Replaces one staff member's weekly template wholesale. */
export async function replaceStaffSchedule(
  db: Database,
  staffId: string,
  shifts: { weekday: number; startTime: string; endTime: string }[],
) {
  await db.delete(staffSchedules).where(eq(staffSchedules.staffId, staffId));
  if (shifts.length === 0) return;

  await db
    .insert(staffSchedules)
    .values(shifts.map((shift) => ({ staffId, ...shift })));
}
