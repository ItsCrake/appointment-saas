import { and, eq, gte, ne, sql } from "drizzle-orm";

import { appointments, marketingOptOuts } from "../schema";
import type { Database } from "../types";

/**
 * The two questions the dispatcher re-asks immediately before sending a
 * win-back.
 *
 * Separate from `retention.ts` because these run per *message* at dispatch
 * time, not per tenant at planning time — and because the eligibility query
 * there answers them in bulk with a different shape. Keeping them apart is what
 * lets the dispatcher check one client cheaply without importing a query that
 * walks a whole booking history.
 */

/** True when the client has nothing on the calendar from `now` onwards. */
export async function hasNoUpcomingBooking(
  db: Database,
  businessId: string,
  clientPhone: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.clientPhone, clientPhone),
        gte(appointments.startsAt, sql`${now.toISOString()}::timestamptz`),
        ne(appointments.status, "cancelled"),
      ),
    )
    .limit(1);

  return row === undefined;
}

export async function isOptedOutOfMarketing(
  db: Database,
  businessId: string,
  clientPhone: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: marketingOptOuts.id })
    .from(marketingOptOuts)
    .where(
      and(
        eq(marketingOptOuts.businessId, businessId),
        eq(marketingOptOuts.clientPhone, clientPhone),
      ),
    )
    .limit(1);

  return row !== undefined;
}
