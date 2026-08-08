import dotenv from "dotenv";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Next.js loads .env.local on its own, but standalone scripts (db:migrate,
// db:seed) and tsx do not. dotenv never overrides an already-set variable,
// so this is a no-op inside the Next.js runtime.
dotenv.config({ path: ".env.local", quiet: true });

type Db = PostgresJsDatabase<typeof schema>;

/**
 * The connection is opened on **first use**, not at import.
 *
 * It used to `throw` at module scope when `DATABASE_URL` was missing, and
 * `postgres()` was called there too. That turns any database misconfiguration
 * into a module that cannot be *loaded*, which is a far worse failure than one
 * that cannot query: every consumer of this file dies with it, including the
 * auth server actions, which need the database only for a rate-limit counter
 * they are explicitly willing to skip.
 *
 * The symptom that traced back to here was `Unexpected token '<', "<!DOCTYPE "`
 * on sign-up. A Server Action whose module fails to load never returns an
 * action result at all — the platform serves an HTML error page, and the
 * client, which is expecting the action's serialised reply, tries to parse
 * `<!DOCTYPE html>` as JSON. Nothing in the action's own error handling can
 * catch that, because the action never ran.
 *
 * Lazily, the same misconfiguration surfaces as a thrown error *inside* a
 * query, where `enforceRateLimits` already fails open and every repository
 * caller already has a boundary.
 */
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

let cached: Db | undefined;

function connect(): Db {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local.",
    );
  }

  const client =
    globalForDb.pgClient ??
    postgres(connectionString, {
      // Supabase's pooled connection (PgBouncer, transaction mode) cannot use
      // prepared statements.
      prepare: false,
      // A pooler that accepts the socket and then stalls would otherwise hold
      // the request until the *platform* times out, and a Vercel 504 is an
      // HTML page — the same unparseable reply described above, reached a
      // different way. Failing the query fast lets the caller's own fallback
      // run inside the function's budget.
      connect_timeout: 10,
    });

  // Reuse across HMR reloads in development, otherwise every edit leaks a pool.
  if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

  return drizzle(client, { schema });
}

function getDb(): Db {
  cached ??= connect();
  return cached;
}

/**
 * Behaves exactly like the Drizzle handle it stands in for; the only difference
 * is *when* the pool is opened. Methods are bound to the real handle so
 * Drizzle's internals never see the proxy as `this`.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const real = getDb();
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
