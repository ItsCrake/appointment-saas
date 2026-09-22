/*
 * WHATSAPP, PER BUSINESS (0036)
 *
 * ---------------------------------------------------------------------------
 * A switch in `/master` that turns automated WhatsApp off for one tenant —
 * a pilot that asked not to message its clients yet, a shop whose numbers are
 * being cleaned up, a tenant the platform stopped paying Meta for — without
 * touching anybody else.
 *
 * **It joins two switches that already exist, and outranks neither.** The
 * `DISABLE_WHATSAPP_DISPATCH` variable and the console's platform-wide toggle
 * still suppress everything; this suppresses one business. Any of the three
 * saying no is no. What it changes is only this tenant's channel walk:
 *
 * - At enqueue, WhatsApp is skipped as if it were not live, so a confirmation
 *   or reminder falls through to SMS or email where the tenant and client have
 *   them — the same path a tenant without WhatsApp has always taken — and a
 *   win-back, which is WhatsApp or nothing, is not queued at all.
 * - At dispatch, anything already queued on WhatsApp for the business is
 *   marked `skipped` with the reason, never `failed`: it is a decision, and
 *   `/master/alerts` is for faults.
 *
 * `true` by default and never backfilled: every existing shop keeps sending
 * exactly as it did.
 *
 * **The platform sets it, and only the platform.** `businesses_owner_all`
 * lets an owner write their own row through PostgREST, so a column there that
 * an owner could flip back is not a control. The trigger refuses a change to
 * this column from the `authenticated` or `anon` role — what PostgREST runs as
 * — and leaves the app's own connection, which is the table owner, alone.
 *
 * Ordering: apply BEFORE the code that reads it ships. Drizzle compiles a bare
 * `.select()` on `businesses` into an explicit column list, so a column in
 * `schema.ts` the database lacks breaks `getActiveBusinessBySlug` — the public
 * booking page — and the whole dashboard. See PROJECT_PLAN §5.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "whatsapp_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "businesses_guard_whatsapp_enabled"()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW."whatsapp_enabled" IS DISTINCT FROM OLD."whatsapp_enabled"
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'whatsapp_enabled is set by the platform, not the tenant'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "businesses_guard_whatsapp_enabled" ON "businesses";
--> statement-breakpoint

CREATE TRIGGER "businesses_guard_whatsapp_enabled"
  BEFORE UPDATE OF "whatsapp_enabled" ON "businesses"
  FOR EACH ROW
  EXECUTE FUNCTION "businesses_guard_whatsapp_enabled"();
