import { and, asc, eq } from "drizzle-orm";

import { services } from "../schema";
import type { Database } from "../types";

export async function listServices(
  db: Database,
  businessId: string,
  { activeOnly = true }: { activeOnly?: boolean } = {},
) {
  return db
    .select()
    .from(services)
    .where(
      activeOnly
        ? and(eq(services.businessId, businessId), eq(services.isActive, true))
        : eq(services.businessId, businessId),
    )
    .orderBy(asc(services.sortOrder), asc(services.name));
}

/**
 * Scoped by businessId on purpose: a service id from another tenant must not
 * resolve, even if the caller guesses a valid uuid.
 */
export async function getService(
  db: Database,
  businessId: string,
  serviceId: string,
) {
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)))
    .limit(1);

  return row ?? null;
}

export async function createService(
  db: Database,
  values: typeof services.$inferInsert,
) {
  const [row] = await db.insert(services).values(values).returning();
  return row;
}

/** Every write is scoped by businessId so a stray id cannot cross tenants. */
export async function updateService(
  db: Database,
  businessId: string,
  serviceId: string,
  values: Partial<typeof services.$inferInsert>,
) {
  const [row] = await db
    .update(services)
    .set(values)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)))
    .returning();

  return row ?? null;
}

/**
 * Soft delete. `appointments.service_id` is ON DELETE RESTRICT, so a service
 * with history cannot be removed — deactivating hides it from the booking page
 * while keeping past appointments readable.
 */
export async function deactivateService(
  db: Database,
  businessId: string,
  serviceId: string,
) {
  return updateService(db, businessId, serviceId, { isActive: false });
}

/** Only safe for a service that was never booked; callers must handle failure. */
export async function deleteService(
  db: Database,
  businessId: string,
  serviceId: string,
) {
  const [row] = await db
    .delete(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)))
    .returning();

  return row ?? null;
}
