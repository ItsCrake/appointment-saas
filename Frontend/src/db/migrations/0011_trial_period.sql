-- Trial clock, for the platform console's expiry alerts and the "+7 days"
-- action. NULL means no trial is running: converted, cancelled, or created
-- before this column existed.
--
-- Nothing enforces it. No job downgrades a lapsed trial and no feature checks
-- it, for the same reason plan_type entitles nobody: there is still no payment
-- provider. It drives alerts and nothing else.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamptz;--> statement-breakpoint

-- Backfill: give every existing trialing tenant a clock from its creation
-- date, so the console is not full of blanks on day one.
UPDATE "businesses"
   SET "trial_ends_at" = "created_at" + interval '14 days'
 WHERE "trial_ends_at" IS NULL
   AND "subscription_status" = 'trialing';--> statement-breakpoint

-- The alert query filters on it and orders by it.
CREATE INDEX IF NOT EXISTS "businesses_trial_ends_idx"
  ON "businesses" ("trial_ends_at")
  WHERE "trial_ends_at" IS NOT NULL;
