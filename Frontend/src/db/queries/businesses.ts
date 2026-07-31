import { and, eq, ne } from "drizzle-orm";

import { businesses } from "../schema";
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

export async function createBusiness(
  db: Database,
  values: typeof businesses.$inferInsert,
) {
  const [row] = await db.insert(businesses).values(values).returning();
  return row;
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
