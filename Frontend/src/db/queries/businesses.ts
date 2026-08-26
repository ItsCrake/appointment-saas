import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

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

/**
 * Tenants who have switched the win-back message on.
 *
 * Filtered in SQL on the one column that is almost always false, so the daily
 * sweep does not load every tenant on the platform to discard nearly all of
 * them. The remaining gates — entitlement, freeze, WhatsApp — are pure checks
 * on the row and run in `retentionBlockedReason`.
 */
export async function listRetentionBusinesses(db: Database) {
  return db
    .select()
    .from(businesses)
    .where(eq(businesses.retentionEnabled, true));
}

/** Public booking pages, for the sitemap. */
export async function listActiveBusinessSlugs(db: Database) {
  return db
    .select({ slug: businesses.slug, createdAt: businesses.createdAt })
    .from(businesses)
    .where(eq(businesses.isActive, true));
}

/** The dashboard's entry point: one business per authenticated owner. */
/**
 * The business this account owns, if any.
 *
 * **Pending rows are excluded on purpose (0028).** A business created for a
 * pilot before its owner has an account is temporarily owned by the *operator*
 * who created it, with the intended address in `pending_owner_email`. Without
 * this filter that shop would appear as the operator's own the moment they
 * opened the dashboard — and `.limit(1)` means it could displace a real one.
 * A row stops being pending the instant it is claimed.
 */
export async function getBusinessByOwner(db: Database, ownerUserId: string) {
  const [row] = await db
    .select()
    .from(businesses)
    .where(
      and(
        eq(businesses.ownerUserId, ownerUserId),
        isNull(businesses.pendingOwnerEmail),
      ),
    )
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

/**
 * Creates a shop for an owner who may not have an account yet (0028).
 *
 * ---------------------------------------------------------------------------
 * The row is owned by `operatorUserId` until it is claimed — see the migration
 * for why `owner_user_id` was not made nullable instead. Two things follow, and
 * both are load-bearing:
 *
 * - RLS keeps the row reachable by that operator and nobody else, because every
 *   policy is `auth.uid() = owner_user_id`. There is no window in which a
 *   pending business is readable by the wrong tenant.
 * - `getBusinessByOwner` filters it out, so it never appears as the operator's
 *   own shop despite the column saying so.
 *
 * The email is stored **lower-cased and trimmed**, which is what makes the
 * partial unique index and the claim lookup agree. Addresses are
 * case-insensitive in practice and a claim that missed on capitalisation would
 * strand a pilot on their first login.
 */
export async function createPendingBusiness(
  db: Database,
  values: {
    operatorUserId: string;
    pendingOwnerEmail: string;
    name: string;
    slug: string;
    phone: string | null;
    timezone?: string;
  },
) {
  const [row] = await db
    .insert(businesses)
    .values({
      ownerUserId: values.operatorUserId,
      pendingOwnerEmail: values.pendingOwnerEmail.trim().toLowerCase(),
      name: values.name,
      slug: values.slug,
      phone: values.phone,
      timezone: values.timezone ?? "Asia/Jerusalem",
      locale: "he",
    })
    .returning();

  return row;
}

/**
 * Binds a waiting business to the account that just signed in.
 *
 * ---------------------------------------------------------------------------
 * **The whole transfer is one statement, and the WHERE clause is the guard.**
 * `pending_owner_email` is matched case-insensitively *and* required to still
 * be non-null, so two concurrent first-logins cannot both claim the same shop:
 * the first UPDATE clears the column and the second matches zero rows. There is
 * no read-then-write window to lose.
 *
 * Ownership moves in the same statement that clears the flag, so the row is
 * never briefly ownerless and never briefly claimed-but-still-pending. From
 * RLS's point of view it belongs to the operator until this commits and to the
 * new owner immediately after.
 *
 * Returns null when nothing was waiting for this address, which is the normal
 * case for every sign-in the platform will ever serve.
 */
export async function claimPendingBusiness(
  db: Database,
  userId: string,
  email: string,
) {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;

  const [row] = await db
    .update(businesses)
    .set({ ownerUserId: userId, pendingOwnerEmail: null })
    .where(
      and(
        sql`lower(${businesses.pendingOwnerEmail}) = ${normalised}`,
        isNotNull(businesses.pendingOwnerEmail),
      ),
    )
    .returning();

  return row ?? null;
}
