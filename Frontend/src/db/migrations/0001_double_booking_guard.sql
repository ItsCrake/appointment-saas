-- The authoritative guard against double-booking.
-- Two clients tapping the same slot at the same instant will beat any
-- application-level availability check; only the database can serialize them.

-- Required to combine uuid equality with range overlap in one GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "business_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('pending', 'confirmed'));
