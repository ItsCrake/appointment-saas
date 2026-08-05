-- Billing lifecycle. Turns the subscription columns from a record of intent
-- into a state machine something can act on, and adds the two tables a payment
-- provider will write to.
--
-- Nothing here charges anyone either: stage 8d wires the provider. What lands
-- now is the state, the audit trail and the enforcement clock.

------------------------------------------------------------------------------
-- 1. Retire the `business` tier.
--
-- The code has mapped this value up to `pro` since stage 8a, so the rows below
-- are already being *read* as pro. This makes the data agree with the code.
-- Mapping up rather than down is deliberate: it was the most expensive tier,
-- and silently demoting whoever paid the most is the worst outcome of a
-- repackaging.
------------------------------------------------------------------------------
UPDATE "businesses" SET "plan_type" = 'pro' WHERE "plan_type" = 'business';--> statement-breakpoint

ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_plan_type_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_plan_type_valid"
  CHECK ("plan_type" IN ('free', 'starter', 'pro'));--> statement-breakpoint

------------------------------------------------------------------------------
-- 2. Widen the status set with `past_due`.
--
-- `lib/plans.ts` has listed this value since stage 8a, ahead of the database
-- being able to store it. That ordering is the rule, not an accident: code
-- learns a value before the database can produce it. Reversed, every read
-- between deploy and migration would see a status it cannot classify, and
-- `toSubscriptionStatus` would quietly resolve it to `trialing` -- handing paid
-- features to a tenant who has stopped paying.
------------------------------------------------------------------------------
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_subscription_status_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_subscription_status_valid"
  CHECK ("subscription_status" IN ('trialing', 'active', 'past_due', 'cancelled'));--> statement-breakpoint

------------------------------------------------------------------------------
-- 3. Lifecycle and provider columns on the tenant.
------------------------------------------------------------------------------

-- When the non-payment grace window started. NULL means no clock is running.
-- Stored explicitly rather than inferred from trial_ends_at, because the other
-- route into grace is a *failed payment*, which has no trial behind it.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "grace_started_at" timestamptz;--> statement-breakpoint

-- Why a tenant is frozen. NULL whenever is_active is true.
--
-- This exists so recovery cannot undo a deliberate act: the sweeper only ever
-- unfreezes 'billing'. Without it, a tenant an admin froze for abuse would be
-- quietly reinstated by their next successful payment.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "frozen_reason" varchar(20);--> statement-breakpoint
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_frozen_reason_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_frozen_reason_valid"
  CHECK ("frozen_reason" IS NULL OR "frozen_reason" IN ('admin', 'billing'));--> statement-breakpoint

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "billing_cycle" varchar(10) NOT NULL DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_billing_cycle_valid";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_billing_cycle_valid"
  CHECK ("billing_cycle" IN ('monthly', 'yearly'));--> statement-breakpoint

-- Opaque provider handles. Deliberately untyped text: every provider formats
-- these differently, and the app never parses them.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "provider_customer_id" text;--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "current_period_end" timestamptz;--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- The freeze sweep's hot query: tenants sitting in grace past the window.
CREATE INDEX IF NOT EXISTS "businesses_grace_idx"
  ON "businesses" ("grace_started_at")
  WHERE "grace_started_at" IS NOT NULL;--> statement-breakpoint

------------------------------------------------------------------------------
-- 4. Billing notification kinds.
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+, but the
-- new value cannot be *used* in that same transaction. Nothing below uses them,
-- so this is safe as written -- do not add a seed or backfill that references
-- these values to this file.
------------------------------------------------------------------------------
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'trial_ending';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'trial_ended';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'payment_failed';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'payment_receipt';--> statement-breakpoint

------------------------------------------------------------------------------
-- 5. subscription_events -- the provider webhook log.
--
-- UNIQUE (provider, provider_event_id) is the same trick as
-- notifications.dedupe_key: providers retry webhooks, and a duplicate
-- `invoice.paid` must not extend a period twice. Scoped by provider as well as
-- id, because two providers can and do mint the same opaque id.
--
-- business_id is nullable and ON DELETE SET NULL: an event that cannot be
-- mapped to a tenant is still worth recording, and a financial event should
-- outlive the tenant it refers to rather than cascade away with it.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "subscription_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid REFERENCES "businesses"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'received',
  "error" text,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CONSTRAINT "subscription_events_provider_event_key"
    UNIQUE ("provider", "provider_event_id"),
  CONSTRAINT "subscription_events_status_valid"
    CHECK ("status" IN ('received', 'processed', 'ignored', 'failed'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscription_events_business_idx"
  ON "subscription_events" ("business_id", "received_at" DESC);--> statement-breakpoint

-- RLS on, ZERO policies -- the same posture as rate_limits. This table holds
-- raw provider payloads, which can carry cardholder metadata and billing
-- addresses. Nothing outside the app's own connection has any business reading
-- it, and an owner has no reason to see the webhook stream at all.
ALTER TABLE "subscription_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

------------------------------------------------------------------------------
-- 6. invoices -- billing history for the owner dashboard.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_invoice_id" text,
  "amount_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'ILS',
  "status" varchar(20) NOT NULL DEFAULT 'open',
  "period_start" timestamptz,
  "period_end" timestamptz,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "paid_at" timestamptz,
  -- Link to the provider's own document. For the Israeli market this is where
  -- the חשבונית מס lives; the app does not generate tax documents itself.
  "hosted_url" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoices_status_valid"
    CHECK ("status" IN ('draft', 'open', 'paid', 'void', 'uncollectible'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_provider_invoice_key"
  ON "invoices" ("provider", "provider_invoice_id")
  WHERE "provider_invoice_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoices_business_idx"
  ON "invoices" ("business_id", "issued_at" DESC);--> statement-breakpoint

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- FOR SELECT, not FOR ALL. Every other tenant table grants full access because
-- the owner genuinely edits those rows. Nobody edits their own invoices: they
-- are written by the webhook handler over the app's connection, and an owner
-- who could INSERT one could mark themselves paid.
CREATE POLICY "invoices_owner_read" ON "invoices"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = invoices.business_id AND b.owner_user_id = auth.uid()
  ));
