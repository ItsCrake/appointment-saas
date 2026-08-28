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
 * The provider a shop collapsing back to one chair keeps: the **longest
 * serving**, by earliest `created_at`.
 *
 * ---------------------------------------------------------------------------
 * **This is deliberately not `primaryStaff()`, and the difference is worth
 * naming.** `primaryStaff` orders by `sortOrder, createdAt, id` — display
 * order first, which is the owner's arrangement of the list. Seniority is a
 * fact about the roster that an owner cannot reorder by accident, and
 * collapsing a team is the one operation where "who has been here longest"
 * is a fairer answer than "who is currently at the top of the list".
 *
 * The two agree wherever nobody has reordered anything, because `sortOrder`
 * defaults to `0` for every row and the tie then breaks on `createdAt` — the
 * same column. They diverge only for a shop that has explicitly dragged a
 * newer provider to the top, and there this keeps the senior one.
 *
 * **No divergence survives the call.** Whoever is kept is the only active row
 * left, so `primaryStaff()` resolves to exactly them on the very next read and
 * the engine books into the person this chose. The warning on `primaryStaff`
 * about two copies of the rule disagreeing is about resolving *bookability*
 * twice; this resolves *seniority* once, and then there is only one candidate.
 *
 * `id` breaks a `createdAt` tie so the order is total — seeded rows can share a
 * timestamp to the microsecond, and an unstable pick would deactivate a
 * different person on each run.
 * ---------------------------------------------------------------------------
 */
function longestServing<T extends { id: string; createdAt: Date }>(
  team: readonly T[],
): T | null {
  return (
    [...team].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

/**
 * Deactivates everyone except the longest-serving provider.
 *
 * Nobody is deleted and no history moves — deactivation is the reversible half
 * of collapsing a team, and turning the switch back on is one click per person.
 * See {@link longestServing} for who is kept and why it is seniority rather
 * than display order.
 *
 * Returns how many rows moved, so the caller can say so rather than reporting a
 * silent success on a shop that already had one chair.
 */
export async function deactivateSecondaryStaff(
  db: Database,
  businessId: string,
): Promise<number> {
  const active = await listActiveStaff(db, businessId);
  const kept = longestServing(active);
  if (!kept) return 0;

  const others = active.filter((member) => member.id !== kept.id);
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
