-- Tenant isolation.
--
-- Supabase exposes every table in `public` through PostgREST using the anon
-- key, which is public by design. Without RLS, anyone holding that key can
-- read and write every tenant's rows. Enabling RLS with no anon policy denies
-- them by default; the owner policies below are what the Phase 3 dashboard
-- will run on.
--
-- The app's own Drizzle connection authenticates as `postgres` (the table
-- owner), which bypasses RLS. Server-side code therefore keeps working, and
-- remains responsible for its own business_id scoping.

ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "working_hours" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "time_off" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An owner sees and edits only their own business.
CREATE POLICY "businesses_owner_all" ON "businesses"
  FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);
--> statement-breakpoint

-- Child tables inherit ownership through businesses. The WITH CHECK clause
-- matters as much as USING: without it an owner could insert rows pointing at
-- somebody else's business_id.
CREATE POLICY "services_owner_all" ON "services"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = services.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = services.business_id AND b.owner_user_id = auth.uid()
  ));
--> statement-breakpoint
CREATE POLICY "working_hours_owner_all" ON "working_hours"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = working_hours.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = working_hours.business_id AND b.owner_user_id = auth.uid()
  ));
--> statement-breakpoint
CREATE POLICY "time_off_owner_all" ON "time_off"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = time_off.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = time_off.business_id AND b.owner_user_id = auth.uid()
  ));
--> statement-breakpoint

-- Appointments carry client names and phone numbers, so there is deliberately
-- no anon policy: the public booking page reads availability through the
-- server, never through PostgREST.
CREATE POLICY "appointments_owner_all" ON "appointments"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = appointments.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = appointments.business_id AND b.owner_user_id = auth.uid()
  ));
