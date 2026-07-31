import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Next.js loads .env.local on its own, but standalone scripts (db:migrate,
// db:seed) and tsx do not. dotenv never overrides an already-set variable,
// so this is a no-op inside the Next.js runtime.
dotenv.config({ path: ".env.local", quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

/**
 * Reuse the client across HMR reloads in development, otherwise every edit
 * leaks a connection pool.
 */
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

export const connection =
  globalForDb.pgClient ??
  postgres(connectionString, {
    // Supabase's pooled connection (PgBouncer, transaction mode) cannot use
    // prepared statements.
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = connection;
}

export const db = drizzle(connection, { schema });
export { schema };
