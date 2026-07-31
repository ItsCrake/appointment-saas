-- The notifications outbox stores client email addresses and phone numbers,
-- so it needs the same tenant isolation as every other table. Without this,
-- the public anon key could read every business's recipient list through
-- PostgREST.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_owner_all" ON "notifications"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = notifications.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = notifications.business_id AND b.owner_user_id = auth.uid()
  ));
