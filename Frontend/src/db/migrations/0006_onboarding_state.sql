ALTER TABLE "businesses" ADD COLUMN "onboarding_completed_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill: a business that already has services was set up before this
-- column existed. Without this, every existing owner is pushed back into
-- onboarding on their next login.
UPDATE "businesses" b
SET "onboarding_completed_at" = b."created_at"
WHERE EXISTS (SELECT 1 FROM "services" s WHERE s."business_id" = b."id");
