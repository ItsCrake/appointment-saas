import { desc, eq } from "drizzle-orm";

import { invoices } from "../schema";
import type { Database } from "../types";

/**
 * Tenant-scoped, like every other function in this directory. The `business_id`
 * filter is explicit rather than inherited from RLS: the app connects as
 * `postgres` and bypasses row-level security entirely, so scoping is the
 * application's job and always has been.
 */
export async function listInvoices(
  db: Database,
  businessId: string,
  limit = 24,
) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.businessId, businessId))
    .orderBy(desc(invoices.issuedAt))
    .limit(limit);
}
