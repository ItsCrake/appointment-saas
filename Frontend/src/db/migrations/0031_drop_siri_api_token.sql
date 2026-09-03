/*
 * DROP THE SIRI TOKEN (0031)
 *
 * ---------------------------------------------------------------------------
 * 0030 added `siri_api_token` for an Apple Shortcuts endpoint that has been
 * removed. The columns are now orphans: nothing reads them, nothing writes
 * them, and one of them holds a live bearer token for a route that no longer
 * exists.
 *
 * **The ordering rule runs the other way for a drop, and that is worth stating
 * because it is the opposite of what §5 warns about.** Adding a column to
 * `schema.ts` before the database has it breaks every `businesses` read, since
 * Drizzle compiles a bare `.select()` into an explicit column list. *Removing*
 * one is safe in either order: a column the database has and the schema does
 * not is simply never named. So the code shipped first and this can be applied
 * whenever — the reverse of every other migration in this folder.
 *
 * `IF EXISTS` on both, so this is a no-op against an environment where 0030
 * never ran.
 * ---------------------------------------------------------------------------
 */

DROP INDEX IF EXISTS "businesses_siri_api_token_key";

ALTER TABLE "businesses"
  DROP COLUMN IF EXISTS "siri_api_token",
  DROP COLUMN IF EXISTS "siri_token_created_at";
