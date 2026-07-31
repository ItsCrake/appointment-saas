import { and, asc, eq, gt, gte, lt } from "drizzle-orm";

import { timeOff } from "../schema";
import type { Database } from "../types";

export async function listUpcomingTimeOff(
  db: Database,
  businessId: string,
  from: Date,
) {
  return db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.businessId, businessId), gte(timeOff.endsAt, from)))
    .orderBy(asc(timeOff.startsAt));
}

export async function createTimeOff(
  db: Database,
  values: typeof timeOff.$inferInsert,
) {
  const [row] = await db.insert(timeOff).values(values).returning();
  return row;
}

export async function deleteTimeOff(
  db: Database,
  businessId: string,
  timeOffId: string,
) {
  const [row] = await db
    .delete(timeOff)
    .where(and(eq(timeOff.businessId, businessId), eq(timeOff.id, timeOffId)))
    .returning();

  return row ?? null;
}

/** Closures overlapping [from, to), using the same half-open convention. */
export async function listTimeOffInRange(
  db: Database,
  businessId: string,
  from: Date,
  to: Date,
) {
  return db
    .select()
    .from(timeOff)
    .where(
      and(
        eq(timeOff.businessId, businessId),
        lt(timeOff.startsAt, to),
        gt(timeOff.endsAt, from),
      ),
    )
    .orderBy(asc(timeOff.startsAt));
}
