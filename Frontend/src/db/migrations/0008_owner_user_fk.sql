-- businesses.owner_user_id has always been a logical FK to auth.users with no
-- constraint behind it. Deleting an owner from Supabase Auth therefore left the
-- business row behind, still holding its slug — and because slug is UNIQUE, the
-- same person re-registering could never reclaim it:
--
--   duplicate key value violates unique constraint "businesses_slug_unique"
--
-- The orphan is also invisible: it belongs to a uuid that no longer resolves to
-- an account, so nobody can sign in and clean it up from the dashboard.

-- Refuse to run rather than guess. If orphans exist, a migration that silently
-- deleted them would destroy tenant appointment history without a prompt.
DO $$
DECLARE orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM businesses b
  LEFT JOIN auth.users u ON u.id = b.owner_user_id
  WHERE u.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add businesses_owner_user_id_fkey: % business row(s) point at a deleted auth user.%',
      orphan_count,
      E'\nInspect them with:\n'
      '  SELECT b.slug, b.name, b.owner_user_id FROM businesses b\n'
      '  LEFT JOIN auth.users u ON u.id = b.owner_user_id WHERE u.id IS NULL;\n'
      'Then either reassign owner_user_id to a live account, or delete those '
      'businesses deliberately, and re-run the migration.';
  END IF;
END $$;
--> statement-breakpoint
-- Postgres does not index the referencing side of a FK automatically, and every
-- cascade would otherwise seq-scan businesses. This also covers the hot path in
-- requireBusiness(), which resolves the tenant by owner_user_id on every
-- dashboard request.
CREATE INDEX IF NOT EXISTS "businesses_owner_user_idx" ON "businesses" ("owner_user_id");--> statement-breakpoint
-- ON DELETE CASCADE: removing an owner account removes their business, and the
-- existing cascades carry that through to services, working_hours, time_off,
-- appointments and notifications.
--
-- This is a real data-destruction path: deleting a row in the Supabase Auth
-- dashboard erases that tenant's entire appointment history and every client
-- name and phone number it held, with no prompt and no undo. That is the
-- intended behaviour pre-launch. If this platform ever holds tenants whose
-- records must survive an account deletion, change this to ON DELETE RESTRICT
-- and delete businesses explicitly instead.
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id")
  ON DELETE CASCADE;
