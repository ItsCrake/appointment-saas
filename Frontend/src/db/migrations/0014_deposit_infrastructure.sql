-- Deposit infrastructure. **Backend only — nothing in the UI reads any of
-- this yet**, and `deposit_enabled` defaults to false so no tenant behaves
-- differently the moment it lands.
--
-- It exists now rather than with the feature for the reason 8a taught: code
-- learns a value before the database can produce it, and the database learns a
-- value before the code writes one. A status the enum does not know is a
-- constraint violation at the worst possible moment.

-- Postgres refuses to let a new enum value be *referenced* in the same
-- transaction that adds it, and Drizzle runs every pending migration in one
-- transaction. So nothing below may name these two values — not in a default,
-- not in a CHECK, and not in an index predicate.
--
-- That is why `0013` inverted the exclusion predicate to list the statuses that
-- *release* a slot instead of the ones that hold it. These two are non-terminal,
-- so they are held by that constraint automatically, from the moment they
-- exist, without this migration mentioning them.
ALTER TYPE "appointment_status" ADD VALUE IF NOT EXISTS 'pending_deposit';
--> statement-breakpoint
ALTER TYPE "appointment_status" ADD VALUE IF NOT EXISTS 'pending_approval';
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   Tenant-level deposit configuration.
--------------------------------------------------------------------------- */

ALTER TABLE "businesses"
  ADD COLUMN "deposit_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- 'manual' (Bit / PayBox, owner confirms by eye) | 'gateway' (a real provider).
ALTER TABLE "businesses"
  ADD COLUMN "deposit_mode" varchar(20) NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_deposit_mode_check"
  CHECK ("deposit_mode" IN ('manual', 'gateway'));
--> statement-breakpoint

-- A flat sum in agorot. Deliberately not a percentage: the Israeli manual flow
-- asks a human to transfer a specific number through Bit, and "30% of ₪180"
-- is not a number anyone types into a payment app correctly.
ALTER TABLE "businesses"
  ADD COLUMN "deposit_amount_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_deposit_amount_check"
  CHECK ("deposit_amount_cents" >= 0);
--> statement-breakpoint

-- Manual mode. The phone number is what a client sends a Bit transfer to; the
-- link covers PayBox and anything else that publishes a payment URL.
ALTER TABLE "businesses" ADD COLUMN "deposit_bit_phone" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deposit_payment_url" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deposit_instructions" text;
--> statement-breakpoint

-- Gateway mode. Opaque handles, never parsed by the app — the same posture as
-- `provider_customer_id` on the subscription side.
ALTER TABLE "businesses" ADD COLUMN "deposit_provider" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deposit_provider_account_id" text;
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   Per-appointment deposit state.
--------------------------------------------------------------------------- */

-- Snapshot, like `price_cents`: the tenant may change their deposit tomorrow
-- and this booking's terms must not move with it.
ALTER TABLE "appointments"
  ADD COLUMN "deposit_amount_cents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- When the *client* said they had transferred it. A claim, not a payment —
-- which is precisely why `pending_approval` is a separate status from paid.
ALTER TABLE "appointments"
  ADD COLUMN "deposit_claimed_at" timestamptz;
--> statement-breakpoint
-- When the owner (manual) or the provider webhook (gateway) confirmed it.
ALTER TABLE "appointments"
  ADD COLUMN "deposit_confirmed_at" timestamptz;
--> statement-breakpoint
-- Gateway transaction reference, or whatever the client typed as proof in
-- manual mode. Opaque either way.
ALTER TABLE "appointments"
  ADD COLUMN "deposit_reference" text;
--> statement-breakpoint

-- **The slot is held while a deposit is outstanding, and no statement here was
-- needed to arrange it.**
--
-- Both new statuses are non-terminal, so `0013`'s inverted predicate covers
-- them the moment the enum learns them. That matters more than it looks: if the
-- slot were released while a deposit was outstanding, two clients could each be
-- told to transfer money for the same time, and the slower one would find it
-- gone having already paid. Holding it is what makes "pay to confirm" honest.
--
-- A test in `db/deposits.test.ts` asserts this rather than trusting the
-- reasoning, because the mechanism is now indirect.
