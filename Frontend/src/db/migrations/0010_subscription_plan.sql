-- Subscription tracking on businesses.
--
-- These columns record what an owner chose during onboarding. They do NOT
-- entitle anyone to anything: no payment provider is wired up, nothing bills
-- against plan_type, and no feature checks it. subscription_status is always
-- 'trialing' until a billing integration exists to move it.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "plan_type" varchar(20) NOT NULL DEFAULT 'starter';--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "subscription_status" varchar(20) NOT NULL DEFAULT 'trialing';--> statement-breakpoint

-- Constrained in the database as well as in Zod: these are short closed sets,
-- and a typo written by a script should not reach a page that switches on it.
-- CHECK rather than an enum type so adding a tier is one migration, not two.
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_plan_type_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_plan_type_valid"
  CHECK ("plan_type" IN ('free', 'starter', 'pro', 'business'));--> statement-breakpoint

ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_subscription_status_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_subscription_status_valid"
  CHECK ("subscription_status" IN ('trialing', 'active', 'cancelled'));
