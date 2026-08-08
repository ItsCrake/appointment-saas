-- Per-staff time off.
--
-- `time_off` closed the whole shop. That is right for a holiday or a
-- renovation and wrong for one barber taking Thursday afternoon, who until now
-- could only express it by editing their weekly hours — which is a permanent
-- change used to describe a one-off absence.
--
-- NULL `staff_id` keeps the existing meaning, so every row already in the table
-- stays business-wide with no backfill and no behaviour change.

ALTER TABLE "time_off" ADD COLUMN "staff_id" uuid;
--> statement-breakpoint

-- A staff member and their absences belong to the same tenant, and this is what
-- makes that structural rather than assumed.
--
-- The FK is **composite** — (business_id, staff_id) against staff — instead of
-- the obvious single-column one. A plain `REFERENCES staff(id)` would happily
-- accept one tenant's staff member on another tenant's closure: both rows
-- exist, so both ends of the constraint are satisfied, and nothing in the
-- schema would notice. Availability would then quietly apply the wrong shop's
-- absence.
--
-- It needs a unique key on the referenced pair. `id` is already the primary
-- key, so this index is redundant for uniqueness and exists only to give the FK
-- something to point at.
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_business_id_key" UNIQUE ("business_id", "id");
--> statement-breakpoint

-- MATCH SIMPLE is the default, and it is the behaviour this needs: when any
-- column of the key is NULL the constraint is **not checked at all**. So a
-- business-wide row — `staff_id IS NULL` — is exempt automatically, and a
-- staff-specific one is fully enforced. No CHECK and no trigger required.
--
-- CASCADE, unlike the appointments FK: an absence is not history. Deleting a
-- staff member who never took a booking should take their time off with them
-- rather than leave rows that no longer refer to anyone.
ALTER TABLE "time_off"
  ADD CONSTRAINT "time_off_staff_fkey"
  FOREIGN KEY ("business_id", "staff_id")
  REFERENCES "staff" ("business_id", "id")
  ON DELETE CASCADE;
--> statement-breakpoint

-- The availability query already narrows by business and range first, so this
-- exists for the dashboard's per-person view rather than for the booking path.
CREATE INDEX "time_off_staff_idx" ON "time_off" ("staff_id", "starts_at");
