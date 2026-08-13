import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { pgSchema, text, uuid } from "drizzle-orm/pg-core";

import { appointments, businesses, notifications } from "../schema";
import type { Database } from "../types";
import { toDate } from "./sql-types";

/**
 * Supabase owns `auth.users`, so it is declared here rather than in
 * `schema.ts` — drizzle.config only introspects that file, and listing it
 * there would invite drizzle-kit to generate a migration for a table this app
 * must never manage. Only the two columns the console reads are modelled.
 */
const authUsers = pgSchema("auth").table("users", {
  id: uuid("id").primaryKey(),
  email: text("email"),
});

/**
 * Platform-wide reads for `/master`. These are the only queries in the app
 * that deliberately cross tenant boundaries, which is why they live in their
 * own module rather than beside the tenant-scoped repository — a function
 * here without a `business_id` filter is intentional, and a reviewer should
 * be able to tell that at a glance.
 *
 * Every one of them must return sensibly on an empty database: `/master` is
 * the first screen a fresh deployment shows.
 */

/** ISO string with an explicit cast — a raw Date has no inferable bind type. */
const at = (value: Date) => sql`${value.toISOString()}::timestamptz`;

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  createdAt: Date;
  isActive: boolean;
  planType: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  bookings: number;
  lastBookingAt: Date | null;
};

/**
 * Every tenant with its lifetime booking count and most recent booking.
 *
 * One left join and a group-by rather than a count per row: the console lists
 * all tenants at once, and a per-row subquery would be N+1 against the table
 * that grows fastest.
 */
export async function listTenants(db: Database): Promise<TenantSummary[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      ownerUserId: businesses.ownerUserId,
      createdAt: businesses.createdAt,
      isActive: businesses.isActive,
      planType: businesses.planType,
      subscriptionStatus: businesses.subscriptionStatus,
      trialEndsAt: businesses.trialEndsAt,
      bookings: sql<number>`count(${appointments.id})::int`,
      lastBookingAt: sql<Date | string | null>`max(${appointments.createdAt})`,
    })
    .from(businesses)
    .leftJoin(appointments, eq(appointments.businessId, businesses.id))
    .groupBy(businesses.id)
    .orderBy(desc(businesses.createdAt));

  // Converted here, not trusted from the annotation — see `toDate`.
  return rows.map((row) => ({
    ...row,
    lastBookingAt: toDate(row.lastBookingAt),
  }));
}

export type PlatformPulse = {
  today: number;
  week: number;
  month: number;
};

/**
 * Bookings created platform-wide. Measured on `created_at`, not `starts_at`:
 * this is a demand signal — how much the platform is being used — not a
 * schedule. A booking made today for next month counts today.
 */
export async function getPlatformPulse(
  db: Database,
  now: Date,
): Promise<PlatformPulse> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [row] = await db
    .select({
      today: sql<number>`count(*) FILTER (WHERE ${appointments.createdAt} >= ${at(dayAgo)})::int`,
      week: sql<number>`count(*) FILTER (WHERE ${appointments.createdAt} >= ${at(weekAgo)})::int`,
      month: sql<number>`count(*) FILTER (WHERE ${appointments.createdAt} >= ${at(monthAgo)})::int`,
    })
    .from(appointments);

  return row ?? { today: 0, week: 0, month: 0 };
}

export type FeedEntry = {
  id: string;
  createdAt: Date;
  startsAt: Date;
  status: string;
  serviceName: string;
  priceCents: number;
  businessName: string;
  businessSlug: string;
  businessTimezone: string;
};

/**
 * Most recently *created* bookings across every tenant.
 *
 * Client names and phone numbers are deliberately not selected. The console
 * exists to observe the platform, and an operator does not need a stranger's
 * contact details to see that bookings are flowing.
 */
export async function listGlobalFeed(
  db: Database,
  limit = 40,
): Promise<FeedEntry[]> {
  return db
    .select({
      id: appointments.id,
      createdAt: appointments.createdAt,
      startsAt: appointments.startsAt,
      status: appointments.status,
      serviceName: appointments.serviceName,
      priceCents: appointments.priceCents,
      businessName: businesses.name,
      businessSlug: businesses.slug,
      businessTimezone: businesses.timezone,
    })
    .from(appointments)
    .innerJoin(businesses, eq(businesses.id, appointments.businessId))
    .orderBy(desc(appointments.createdAt))
    .limit(limit);
}

export type FailedDelivery = {
  id: string;
  channel: string;
  kind: string;
  attempts: number;
  lastError: string | null;
  scheduledFor: Date;
  businessName: string;
};

/** Notifications the dispatcher gave up on, newest first. */
export async function listFailedDeliveries(
  db: Database,
  limit = 25,
): Promise<FailedDelivery[]> {
  return db
    .select({
      id: notifications.id,
      channel: notifications.channel,
      kind: notifications.kind,
      attempts: notifications.attempts,
      lastError: notifications.lastError,
      scheduledFor: notifications.scheduledFor,
      businessName: businesses.name,
    })
    .from(notifications)
    .innerJoin(businesses, eq(businesses.id, notifications.businessId))
    .where(eq(notifications.status, "failed"))
    .orderBy(desc(notifications.scheduledFor))
    .limit(limit);
}

/**
 * Tenants that finished onboarding but took no booking in the window.
 *
 * Onboarding-complete only: an account still mid-setup has not churned, it has
 * not started. Counting it as at-risk would fill the alert list with noise on
 * every signup.
 */
export async function listChurnRisk(
  db: Database,
  now: Date,
  quietDays = 7,
): Promise<TenantSummary[]> {
  const since = new Date(now.getTime() - quietDays * 86_400_000);

  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      ownerUserId: businesses.ownerUserId,
      createdAt: businesses.createdAt,
      isActive: businesses.isActive,
      planType: businesses.planType,
      subscriptionStatus: businesses.subscriptionStatus,
      trialEndsAt: businesses.trialEndsAt,
      bookings: sql<number>`count(${appointments.id}) FILTER (WHERE ${appointments.createdAt} >= ${at(since)})::int`,
      lastBookingAt: sql<Date | string | null>`max(${appointments.createdAt})`,
    })
    .from(businesses)
    .leftJoin(appointments, eq(appointments.businessId, businesses.id))
    .where(
      and(
        eq(businesses.isActive, true),
        sql`${businesses.onboardingCompletedAt} IS NOT NULL`,
        // Give a new tenant the window itself before calling it quiet.
        lt(businesses.createdAt, since),
      ),
    )
    .groupBy(businesses.id)
    .having(
      sql`count(${appointments.id}) FILTER (WHERE ${appointments.createdAt} >= ${at(since)}) = 0`,
    )
    .orderBy(desc(businesses.createdAt));

  // Converted here, not trusted from the annotation — see `toDate`.
  return rows.map((row) => ({
    ...row,
    lastBookingAt: toDate(row.lastBookingAt),
  }));
}

/** Trials lapsing inside the window, soonest first. */
export async function listExpiringTrials(
  db: Database,
  now: Date,
  withinHours = 48,
): Promise<TenantSummary[]> {
  const limit = new Date(now.getTime() + withinHours * 3_600_000);

  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      ownerUserId: businesses.ownerUserId,
      createdAt: businesses.createdAt,
      isActive: businesses.isActive,
      planType: businesses.planType,
      subscriptionStatus: businesses.subscriptionStatus,
      trialEndsAt: businesses.trialEndsAt,
      bookings: sql<number>`0::int`,
      lastBookingAt: sql<Date | string | null>`NULL::timestamptz`,
    })
    .from(businesses)
    .where(
      and(
        eq(businesses.subscriptionStatus, "trialing"),
        gte(businesses.trialEndsAt, now),
        lt(businesses.trialEndsAt, limit),
      ),
    )
    .orderBy(businesses.trialEndsAt);

  // Converted here, not trusted from the annotation — see `toDate`.
  return rows.map((row) => ({
    ...row,
    lastBookingAt: toDate(row.lastBookingAt),
  }));
}

/** Adds days to a trial, starting from now if the clock already lapsed. */
export async function extendTrial(
  db: Database,
  businessId: string,
  days: number,
  now: Date,
): Promise<Date | null> {
  const [row] = await db
    .update(businesses)
    .set({
      // greatest(): extending a trial that ended last week should give the
      // full window from today, not a date still in the past.
      trialEndsAt: sql`greatest(coalesce(${businesses.trialEndsAt}, ${at(now)}), ${at(now)}) + ${sql.raw(`interval '${Math.trunc(days)} days'`)}`,
    })
    .where(eq(businesses.id, businessId))
    .returning({ trialEndsAt: businesses.trialEndsAt });

  return row?.trialEndsAt ?? null;
}

export async function setTenantActive(
  db: Database,
  businessId: string,
  isActive: boolean,
): Promise<boolean> {
  const [row] = await db
    .update(businesses)
    .set({ isActive })
    .where(eq(businesses.id, businessId))
    .returning({ id: businesses.id });

  return Boolean(row);
}

/**
 * Owner email per business id. A separate lookup rather than a join in
 * `listTenants`, because that query groups over appointments and adding a
 * second table to the group-by is a needless widening of the scan.
 *
 * Returns an empty map rather than throwing when the roster is empty.
 */
export async function getOwnerEmails(
  db: Database,
  ownerUserIds: string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ownerUserIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: authUsers.id, email: authUsers.email })
    .from(authUsers)
    .where(inArray(authUsers.id, unique));

  return new Map(rows.map((row) => [row.id, row.email]));
}
