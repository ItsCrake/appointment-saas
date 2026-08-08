-- A portrait for a staff member, shown in the booking flow's staff picker.
--
-- Presentation only, like every other media column: the availability engine and
-- the booking rules never read it, so a broken value produces a plain avatar
-- rather than a wrong appointment.
--
-- NULL is the normal state and stays the normal state — the picker falls back
-- to a monogram, which is what a one-chair shop that never uploads anything
-- will always see.
ALTER TABLE "staff" ADD COLUMN "image_url" text;
--> statement-breakpoint

-- Bounded for the same reason `businesses` bounds its media URLs: the column is
-- rendered straight into a `src`, and an unbounded text column is an invitation
-- to paste a data: URI the size of the image itself into the row.
--
-- The *protocol* is not checked here. `isSafeMediaUrl` does that on read, which
-- is the only place that can also cope with a value written by a seed or by
-- psql — a CHECK would reject those at write time and still leave the reader
-- needing the guard.
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_image_url_length_check"
  CHECK (coalesce(length("image_url"), 0) <= 500);
