-- Multi-staff.
--
-- The delicate part of this migration is the double-booking guard. It is the
-- one invariant in this schema that application code cannot re-derive, so the
-- ordering below is deliberate: the *new* constraint is added while the old one
-- is still in force, and only then is the old one dropped. There is no instant
-- at which the table is unguarded, and because both are briefly active — the
-- old one being strictly stricter — nothing can slip through the overlap.

CREATE TABLE "staff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  -- Optional, e.g. "ספר בכיר". A picker of bare names is harder to choose from.
  "title" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "staff_business_active_idx" ON "staff" ("business_id", "is_active");
--> statement-breakpoint

-- Per-staff weekly hours. **No rows means "inherit the business hours"**, which
-- is what keeps a single-staff shop from ever having to fill this in, and what
-- makes the backfill below correct without generating a row per weekday.
CREATE TABLE "staff_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "staff_id" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
  "weekday" smallint NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  CONSTRAINT "staff_schedules_staff_weekday_start_key"
    UNIQUE ("staff_id", "weekday", "start_time")
);
--> statement-breakpoint
CREATE INDEX "staff_schedules_staff_weekday_idx"
  ON "staff_schedules" ("staff_id", "weekday");
--> statement-breakpoint

-- The single binary question asked during setup. An explicit column rather than
-- `count(staff) > 1`, because the owner has to be able to answer "yes" *before*
-- adding anyone, and to collapse back to single-staff without deleting people.
ALTER TABLE "businesses"
  ADD COLUMN "has_multiple_staff" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Every existing tenant gets exactly one staff member, named after the
-- business. It is the least-wrong default: there is no owner name anywhere in
-- this schema, and a recognisable label beats "עובד 1" in a picker the owner
-- will rename anyway.
INSERT INTO "staff" ("business_id", "name", "sort_order")
SELECT "id", "name", 0 FROM "businesses";
--> statement-breakpoint

ALTER TABLE "appointments" ADD COLUMN "staff_id" uuid;
--> statement-breakpoint

-- Deterministic even if a business somehow already had more than one row:
-- oldest first, then id, so re-running against a partially-migrated database
-- picks the same staff member every time.
UPDATE "appointments" a
SET "staff_id" = (
  SELECT s."id" FROM "staff" s
  WHERE s."business_id" = a."business_id"
  ORDER BY s."created_at", s."id"
  LIMIT 1
);
--> statement-breakpoint

ALTER TABLE "appointments" ALTER COLUMN "staff_id" SET NOT NULL;
--> statement-breakpoint

-- RESTRICT, not CASCADE: an appointment is history, and deleting a staff member
-- must not delete the record that someone was seen. The dashboard deactivates
-- rather than deletes, and this constraint is what makes that the only option
-- once a staff member has taken a booking.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "appointments_staff_starts_idx"
  ON "appointments" ("staff_id", "starts_at");
--> statement-breakpoint

-- The new guard, added while the old one still stands.
--
-- `business_id` is kept alongside `staff_id` even though a staff id already
-- implies its business: it keeps the index useful for the business-scoped range
-- scans the agenda runs, and it states the tenant boundary in the constraint
-- rather than leaving it implied by a join.
--
-- **The predicate is inverted, and that is deliberate.** It used to list the
-- statuses that hold a slot; it now lists the ones that release it. The two are
-- exactly equivalent today. The difference is what happens when a status is
-- added: `0014` introduces `pending_deposit` and `pending_approval`, and a new
-- enum value cannot be *referenced* in the same transaction that adds it —
-- Drizzle runs every pending migration in one transaction, so a predicate
-- naming them would fail on any database applying both at once. Worse, PGlite
-- executes statement by statement and would have passed, so the suite would
-- have proved the opposite of production.
--
-- Stated positively: any status that is not terminal holds the slot. Anything
-- added later that should *release* one has to be listed here — which fails
-- toward over-holding a slot rather than double-booking it.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap_staff"
  EXCLUDE USING gist (
    "business_id" WITH =,
    "staff_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('cancelled', 'completed', 'no_show'));
--> statement-breakpoint

-- Only now. Dropping first would open a window in which two clients racing for
-- the same slot could both win.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";
--> statement-breakpoint

ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "staff_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "staff_owner_all" ON "staff"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = staff.business_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = staff.business_id AND b.owner_user_id = auth.uid()
  ));
--> statement-breakpoint

-- Two hops, because staff_schedules carries no business_id of its own. Scoping
-- it through staff keeps the schedule inseparable from the person it belongs
-- to, which is the property that matters.
CREATE POLICY "staff_schedules_owner_all" ON "staff_schedules"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s
    JOIN businesses b ON b.id = s.business_id
    WHERE s.id = staff_schedules.staff_id AND b.owner_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM staff s
    JOIN businesses b ON b.id = s.business_id
    WHERE s.id = staff_schedules.staff_id AND b.owner_user_id = auth.uid()
  ));
