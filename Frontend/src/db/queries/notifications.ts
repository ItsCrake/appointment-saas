import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

import { appointments, businesses, notifications } from "../schema";
import type { Database } from "../types";

/**
 * Insert-if-absent. The unique `dedupe_key` is what makes enqueueing safe to
 * call from anywhere — a retried Server Action cannot produce a second email.
 */
export async function enqueueNotification(
  db: Database,
  values: typeof notifications.$inferInsert,
) {
  const [row] = await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning();

  return row ?? null;
}

/** Pending rows that are due, joined to everything a template needs. */
export async function listDueNotifications(
  db: Database,
  now: Date,
  limit = 50,
) {
  return db
    .select({
      notification: notifications,
      business: businesses,
      appointment: appointments,
    })
    .from(notifications)
    .innerJoin(businesses, eq(notifications.businessId, businesses.id))
    .leftJoin(appointments, eq(notifications.appointmentId, appointments.id))
    .where(
      and(
        eq(notifications.status, "pending"),
        lte(notifications.scheduledFor, now),
      ),
    )
    .orderBy(asc(notifications.scheduledFor))
    .limit(limit);
}

export async function markNotificationSent(
  db: Database,
  id: string,
  sentAt: Date,
) {
  await db
    .update(notifications)
    .set({
      status: "sent",
      sentAt,
      lastError: null,
      attempts: sql`${notifications.attempts} + 1`,
    })
    .where(eq(notifications.id, id));
}

/**
 * `retryable` keeps the row pending so the next cron run picks it up; a
 * permanent failure is parked as `failed` and never retried.
 */
export async function markNotificationFailed(
  db: Database,
  id: string,
  error: string,
  retryable: boolean,
  maxAttempts = 5,
) {
  await db
    .update(notifications)
    .set({
      status: retryable
        ? sql`CASE WHEN ${notifications.attempts} + 1 >= ${maxAttempts} THEN 'failed'::notification_status ELSE 'pending'::notification_status END`
        : "failed",
      lastError: error.slice(0, 500),
      attempts: sql`${notifications.attempts} + 1`,
    })
    .where(eq(notifications.id, id));
}

/** Used when the appointment moved on — e.g. a reminder for a cancelled slot. */
export async function markNotificationSkipped(
  db: Database,
  id: string,
  reason: string,
) {
  await db
    .update(notifications)
    .set({ status: "skipped", lastError: reason.slice(0, 500) })
    .where(eq(notifications.id, id));
}

/** Cancels queued messages for an appointment, e.g. its pending reminder. */
export async function cancelPendingNotificationsForAppointment(
  db: Database,
  appointmentId: string,
  reason = "appointment cancelled",
) {
  const rows = await db
    .update(notifications)
    .set({ status: "skipped", lastError: reason })
    .where(
      and(
        eq(notifications.appointmentId, appointmentId),
        eq(notifications.status, "pending"),
      ),
    )
    .returning({ id: notifications.id });

  return rows.length;
}

export async function listRecentNotifications(
  db: Database,
  businessId: string,
  limit = 20,
) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.businessId, businessId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
