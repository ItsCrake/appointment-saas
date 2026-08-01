import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "@/db/schema";
import type { Database } from "@/db/types";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "src/db/migrations");

/**
 * Real Postgres in WASM, migrated exactly like production. Slower than mocking
 * the query layer, but it is the only way to prove the exclusion constraint,
 * enum casts, and timezone handling actually behave.
 */
export async function createTestDb() {
  const pg = await PGlite.create({ extensions: { btree_gist } });

  // Supabase ships an `auth` schema and the anon/authenticated roles that
  // PGlite does not. The RLS migration references both, so stub the surface it
  // needs and keep migrations byte-identical across environments.
  //
  // `auth.users` is a real table here, not a view or a stub: migration 0008
  // adds a FK to it with ON DELETE CASCADE, and the point of running the real
  // migrations is that a cascade which loses tenant data is proved rather than
  // assumed. Only `id` matters — the rest of Supabase's column set is
  // irrelevant to anything this schema does.
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    DO $$ BEGIN
      CREATE ROLE anon NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE ROLE authenticated NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await pg.exec(statement);
    }
  }

  const db = drizzle(pg, { schema }) as unknown as Database;

  return { pg, db, close: () => pg.close() };
}
