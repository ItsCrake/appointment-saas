import { and, asc, eq } from "drizzle-orm";

import { workingHours } from "../schema";
import type { Database } from "../types";

export async function listWorkingHours(db: Database, businessId: string) {
  return db
    .select()
    .from(workingHours)
    .where(eq(workingHours.businessId, businessId))
    .orderBy(asc(workingHours.weekday), asc(workingHours.startTime));
}

/**
 * Replaces the whole weekly template in one transaction. Simpler and safer
 * than diffing rows: the unique (business, weekday, start) key makes partial
 * updates collision-prone.
 */
export async function replaceWorkingHours(
  db: Database,
  businessId: string,
  rows: Omit<typeof workingHours.$inferInsert, "businessId">[],
) {
  return db.transaction(async (tx) => {
    await tx
      .delete(workingHours)
      .where(eq(workingHours.businessId, businessId));

    if (rows.length === 0) return [];

    return tx
      .insert(workingHours)
      .values(rows.map((row) => ({ ...row, businessId })))
      .returning();
  });
}

/** Every shift on one weekday. More than one row means a split shift. */
export async function listWorkingHoursForWeekday(
  db: Database,
  businessId: string,
  weekday: number,
) {
  return db
    .select()
    .from(workingHours)
    .where(
      and(
        eq(workingHours.businessId, businessId),
        eq(workingHours.weekday, weekday),
        eq(workingHours.isClosed, false),
      ),
    )
    .orderBy(asc(workingHours.startTime));
}
