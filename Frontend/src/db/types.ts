import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

/**
 * Driver-agnostic Drizzle handle. Satisfied by the postgres-js client used at
 * runtime and by the PGlite client used in tests, so query functions never
 * depend on a concrete driver.
 */
export type Database = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
