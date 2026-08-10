import { and, eq, isNull, ne } from "drizzle-orm";

import { businesses, staff } from "../schema";
import type { Database } from "../types";

export async function getBusinessById(db: Database, businessId: string) {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  return row ?? null;
}

/** Resolves the public booking page at /[slug]. Inactive businesses 404. */
export async function getActiveBusinessBySlug(db: Database, slug: string) {
  const [row] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.slug, slug), eq(businesses.isActive, true)))
    .limit(1);

  return row ?? null;
}

/**
 * Whether `/[slug]` resolves to anything, without fetching the row.
 *
 * The proxy's 404 guard asks this before every public page render, so it selects
 * one indexed column rather than `*`. **The predicate must stay identical to
 * `getActiveBusinessBySlug`** — if this said yes where that says no, the page
 * would render, call `notFound()`, and answer 200 again for exactly the
 * deactivated tenants the guard was meant to cover.
 */
export async function activeBusinessSlugExists(db: Database, slug: string) {
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.slug, slug), eq(businesses.isActive, true)))
    .limit(1);

  return row !== undefined;
}

/** Public booking pages, for the sitemap. */
export async function listActiveBusinessSlugs(db: Database) {
  return db
    .select({ slug: businesses.slug, createdAt: businesses.createdAt })
    .from(businesses)
    .where(eq(businesses.isActive, true));
}

/** The dashboard's entry point: one business per authenticated owner. */
export async function getBusinessByOwner(db: Database, ownerUserId: string) {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.ownerUserId, ownerUserId))
    .limit(1);

  return row ?? null;
}

export async function isSlugTaken(
  db: Database,
  slug: string,
  exceptBusinessId?: string,
) {
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      exceptBusinessId
        ? and(eq(businesses.slug, slug), ne(businesses.id, exceptBusinessId))
        : eq(businesses.slug, slug),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * Creates the business **and its first staff member**, which is not optional.
 *
 * `appointments.staff_id` is NOT NULL and the exclusion constraint keys on it,
 * so a business with no staff row cannot take a booking at all. Migration 0013
 * backfilled every tenant that existed; this is the same guarantee for every
 * tenant created since, and it belongs here rather than in the setup action so
 * a second creation path cannot forget it.
 *
 * The staff member is named after the business for the same reason the
 * backfill did: there is no owner name in this schema, and a recognisable
 * label beats a placeholder in a picker the owner will rename anyway.
 */
export async function createBusiness(
  db: Database,
  values: typeof businesses.$inferInsert,
) {
  const [row] = await db.insert(businesses).values(values).returning();
  await db.insert(staff).values({ businessId: row.id, name: row.name });
  return row;
}

/** Idempotent: re-running the finish step must not move the timestamp. */
export async function completeOnboarding(
  db: Database,
  businessId: string,
  at: Date = new Date(),
) {
  const [row] = await db
    .update(businesses)
    .set({ onboardingCompletedAt: at })
    .where(
      and(
        eq(businesses.id, businessId),
        isNull(businesses.onboardingCompletedAt),
      ),
    )
    .returning();

  return row ?? null;
}

export async function updateBusiness(
  db: Database,
  businessId: string,
  values: Partial<typeof businesses.$inferInsert>,
) {
  const [row] = await db
    .update(businesses)
    .set(values)
    .where(eq(businesses.id, businessId))
    .returning();

  return row ?? null;
}
