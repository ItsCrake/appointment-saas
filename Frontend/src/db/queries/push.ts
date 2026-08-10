import { and, eq, isNull, sql } from "drizzle-orm";

import { pushSubscriptions } from "../schema";
import type { Database } from "../types";

/**
 * Registers a device, or revives one that had lapsed.
 *
 * An upsert on `endpoint`, because the browser hands out the same endpoint for
 * the same registration — a second subscribe from a device that already has one
 * is the normal case (a reinstall, a permission re-grant), not a duplicate.
 *
 * `expiredAt` is cleared on conflict: the endpoint answering again is proof it
 * is no longer gone, and leaving it set would keep the device silently skipped.
 */
export async function savePushSubscription(
  db: Database,
  values: {
    businessId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
  },
) {
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      businessId: values.businessId,
      endpoint: values.endpoint,
      p256dh: values.p256dh,
      auth: values.auth,
      userAgent: values.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // The business too: a device could in principle be re-used by a
        // different owner on a shared machine, and the newest claim wins.
        businessId: values.businessId,
        p256dh: values.p256dh,
        auth: values.auth,
        userAgent: values.userAgent ?? null,
        expiredAt: sql`NULL`,
      },
    })
    .returning();

  return row;
}

/** Every live device for a tenant. Lapsed rows are skipped, not deleted. */
export async function listPushSubscriptions(db: Database, businessId: string) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.businessId, businessId),
        isNull(pushSubscriptions.expiredAt),
      ),
    );
}

/**
 * Removes one device, scoped by tenant.
 *
 * Scoped even though `endpoint` is globally unique: an endpoint arrives from
 * the browser, and an action that deletes by a client-supplied key alone is one
 * crafted request away from unsubscribing somebody else's phone.
 */
export async function deletePushSubscription(
  db: Database,
  businessId: string,
  endpoint: string,
) {
  const [row] = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.businessId, businessId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning();

  return row ?? null;
}

/** Marks a device gone after the push service reports 404/410. */
export async function markPushSubscriptionExpired(
  db: Database,
  endpoint: string,
  now = new Date(),
) {
  await db
    .update(pushSubscriptions)
    .set({ expiredAt: now })
    .where(eq(pushSubscriptions.endpoint, endpoint));
}
