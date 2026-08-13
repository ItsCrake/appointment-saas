import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { appointments, staff, staffSchedules } from "../schema";
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
 * The one provider a single-staff tenant books into, picked from a list that is
 * already in hand.
 *
 * Exists so "who is the primary" is defined **once**. It is the head of
 * `listActiveStaff`, whose ordering is total by construction
 * (`sortOrder, createdAt, id`) — the owner's intent first, the id only to break
 * a tie that would otherwise move a walk-in between providers on a refresh.
 * Both the availability engine and the manual-booking action resolve it, and
 * two copies of the rule would eventually disagree about who takes a booking.
 */
export function primaryStaff<T>(team: readonly T[]): T | null {
  return team[0] ?? null;
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
  return primaryStaff(await listActiveStaff(db, businessId));
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
  values: {
    businessId: string;
    name: string;
    title?: string | null;
    phone?: string | null;
    color?: string;
    imageUrl?: string | null;
  },
) {
  const [row] = await db
    .insert(staff)
    .values({
      businessId: values.businessId,
      name: values.name,
      title: values.title ?? null,
      phone: values.phone ?? null,
      imageUrl: values.imageUrl ?? null,
      ...(values.color ? { color: values.color } : {}),
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
    phone?: string | null;
    color?: string;
    imageUrl?: string | null;
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

/**
 * Deactivates everyone except the primary provider.
 *
 * Driven by the same `primaryStaff()` rule availability uses, so the person
 * left standing is exactly the one who will take the bookings — resolving it
 * differently here would deactivate the provider the engine then tries to book
 * into.
 *
 * Returns how many rows moved, so the caller can say so rather than reporting a
 * silent success on a shop that already had one chair.
 */
export async function deactivateSecondaryStaff(
  db: Database,
  businessId: string,
): Promise<number> {
  const active = await listActiveStaff(db, businessId);
  const primary = primaryStaff(active);
  if (!primary) return 0;

  const others = active.filter((member) => member.id !== primary.id);
  if (others.length === 0) return 0;

  await db
    .update(staff)
    .set({ isActive: false })
    .where(
      and(
        eq(staff.businessId, businessId),
        inArray(
          staff.id,
          others.map((member) => member.id),
        ),
      ),
    );

  return others.length;
}

/**
 * How many appointments a provider holds, ever.
 *
 * The gate on deletion. `appointments.staff_id` is `ON DELETE RESTRICT`, so the
 * database would refuse anyway — this exists to turn that refusal into a
 * sentence naming the number, before anything is attempted.
 */
export async function countStaffAppointments(
  db: Database,
  businessId: string,
  staffId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.staffId, staffId),
      ),
    );

  return row?.count ?? 0;
}

/**
 * Hard delete, tenant-scoped.
 *
 * Only ever reached for a provider with no appointments — the caller checks,
 * and the FK is the backstop. `staff_schedules` and any staff-specific
 * `time_off` cascade, which is right: a schedule and an absence describe a
 * person who no longer exists here.
 */
export async function deleteStaff(
  db: Database,
  businessId: string,
  staffId: string,
) {
  await db
    .delete(staff)
    .where(and(eq(staff.businessId, businessId), eq(staff.id, staffId)));
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
