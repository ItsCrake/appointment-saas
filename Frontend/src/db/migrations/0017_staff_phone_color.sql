-- Contact and calendar colour for a staff member.

-- Not a login and not a notification channel: nothing dispatches to it. It is
-- there so an owner can reach the person from the staff list, which on a busy
-- morning is what they actually need it for.
ALTER TABLE "staff" ADD COLUMN "phone" text;
--> statement-breakpoint

-- A swatch *name*, never a hex value, and the same reasoning as
-- `businesses.theme_color`: Tailwind cannot build a class from a runtime value,
-- so the colour has to resolve through a fixed set the stylesheet knows about.
-- Storing `#7c3aed` would give the calendar a value it cannot render and no way
-- to guarantee it is legible against the surface behind it.
--
-- varchar rather than an enum, again like theme_color: adding a swatch should
-- be a stylesheet change, not a migration and a deploy. `lib/staff-colors.ts`
-- validates on read, so an unrecognised value renders the default instead of
-- breaking the agenda.
ALTER TABLE "staff"
  ADD COLUMN "color" varchar(20) NOT NULL DEFAULT 'slate';
--> statement-breakpoint

-- Existing rows all took the default, which is correct for them: a tenant that
-- never used staff has no colour preference to preserve. Nothing else to
-- backfill.
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_phone_length_check"
  CHECK (coalesce(length("phone"), 0) <= 40);
