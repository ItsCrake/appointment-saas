import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import {
  appointments,
  businesses,
  services,
  timeOff,
  workingHours,
} from "@/db/schema";
import type { Database } from "@/db/types";

export const TZ = "Asia/Jerusalem";

/**
 * Supabase owns `auth.users`, so it is not in the Drizzle schema and has to be
 * seeded with raw SQL. Idempotent, because a test may point several businesses
 * at one owner.
 */
export async function createAuthUser(db: Database, id: string = randomUUID()) {
  await db.execute(
    sql`insert into auth.users (id, email) values (${id}, ${`${id}@example.test`})
        on conflict (id) do nothing`,
  );
  return id;
}

export async function createBusiness(
  db: Database,
  overrides: Partial<typeof businesses.$inferInsert> = {},
) {
  // businesses.owner_user_id is a FK to auth.users as of migration 0008, so the
  // owner has to exist before the business does.
  const ownerUserId = overrides.ownerUserId ?? randomUUID();
  await createAuthUser(db, ownerUserId);

  const [row] = await db
    .insert(businesses)
    .values({
      slug: `biz-${randomUUID().slice(0, 8)}`,
      name: "מספרת בדיקה",
      timezone: TZ,
      slotIntervalMin: 15,
      bufferMin: 0,
      minNoticeMin: 0,
      maxAdvanceDays: 365,
      ...overrides,
      ownerUserId,
    })
    .returning();

  return row;
}

export async function createService(
  db: Database,
  businessId: string,
  overrides: Partial<typeof services.$inferInsert> = {},
) {
  const [row] = await db
    .insert(services)
    .values({
      businessId,
      name: "תספורת גבר",
      durationMin: 30,
      priceCents: 7000,
      ...overrides,
    })
    .returning();

  return row;
}

/** One shift. Call twice on the same weekday to build a split shift. */
export async function createShift(
  db: Database,
  businessId: string,
  weekday: number,
  startTime: string,
  endTime: string,
  isClosed = false,
) {
  const [row] = await db
    .insert(workingHours)
    .values({ businessId, weekday, startTime, endTime, isClosed })
    .returning();

  return row;
}

export async function createAppointment(
  db: Database,
  businessId: string,
  serviceId: string,
  startsAt: Date,
  endsAt: Date,
  overrides: Partial<typeof appointments.$inferInsert> = {},
) {
  const [row] = await db
    .insert(appointments)
    .values({
      businessId,
      serviceId,
      startsAt,
      endsAt,
      clientName: "דני",
      clientPhone: "050-0000000",
      serviceName: "תספורת גבר",
      priceCents: 7000,
      cancelToken: randomUUID(),
      ...overrides,
    })
    .returning();

  return row;
}

export async function createTimeOff(
  db: Database,
  businessId: string,
  startsAt: Date,
  endsAt: Date,
  reason = "חופשה",
) {
  const [row] = await db
    .insert(timeOff)
    .values({ businessId, startsAt, endsAt, reason })
    .returning();

  return row;
}
