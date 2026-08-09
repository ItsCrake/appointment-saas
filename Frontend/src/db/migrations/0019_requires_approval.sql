-- "תורים באישור" — the owner vets each request before it becomes a booking.
--
-- Defaults to false, so no existing tenant changes behaviour the moment this
-- lands. A shop that turns it on is choosing to add a step for their clients,
-- which is only worth it for shops where it genuinely is a request.

ALTER TABLE "businesses"
  ADD COLUMN "requires_approval" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- The status used is the enum's existing `pending`, not `pending_approval`.
--
-- `pending_approval` belongs to the deposit flow that 0014 laid out: it means
-- "the client says they transferred the money, the owner has not checked yet".
-- Approving a *booking request* is a different question about a different
-- thing, and the two will eventually coexist on one appointment. `pending` is
-- already non-terminal — so the exclusion constraint holds its slot from the
-- moment it is written — and already renders as "ממתין" everywhere.

/* ---------------------------------------------------------------------------
   Notification kinds for the three moments this feature creates.
--------------------------------------------------------------------------- */

-- Same rule as 0014: Postgres refuses to let a new enum value be *referenced*
-- in the transaction that adds it, and Drizzle runs every pending migration in
-- one transaction. Nothing below may name these — no default, no CHECK, no
-- index predicate. They are only ever written by application code, later.
--
-- Three rather than reusing `booking_confirmation`, because the client is told
-- three genuinely different things and a template cannot infer which from the
-- row: at dispatch time a rejected request and a cancelled booking are both
-- simply `cancelled`, so one kind could not tell them apart.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'booking_pending';
--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'booking_approved';
--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'booking_rejected';
