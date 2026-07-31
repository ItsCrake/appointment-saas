import { lt, sql } from "drizzle-orm";

import { rateLimits } from "../schema";
import type { Database } from "../types";

/**
 * Atomically increments the window counter and returns the new value.
 * ON CONFLICT makes this a single round trip and safe under concurrency —
 * two simultaneous bookings cannot both read a stale count.
 */
export async function incrementRateLimit(
  db: Database,
  key: string,
  windowStart: Date,
  expiresAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, windowStart, expiresAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  return row?.count ?? 1;
}

/** Housekeeping for the notifications cron; expired windows carry no value. */
export async function pruneExpiredRateLimits(db: Database, now: Date) {
  const rows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.expiresAt, now))
    .returning({ key: rateLimits.key });

  return rows.length;
}
