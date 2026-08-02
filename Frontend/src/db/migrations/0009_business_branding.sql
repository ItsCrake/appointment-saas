-- Per-business branding for the public booking page. Presentation only: none
-- of these columns is read by the availability engine or the booking rules, so
-- a bad value can never produce a wrong appointment — only a plain page.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "theme_color" varchar(20) NOT NULL DEFAULT 'indigo';--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "hero_media_url" text;--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "hero_media_type" varchar(10);--> statement-breakpoint

-- jsonb, not text[]: the array position is the display order for the gallery,
-- and reviews are objects. Defaulting to '[]' rather than NULL means every
-- read gets an array and no call site needs a null branch.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "gallery_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "reviews" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

-- Both columns are always arrays. Without this a single object written by hand
-- would reach the page as something the reader has to defend against; the
-- reader defends anyway, but the database should not have allowed it.
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_gallery_urls_is_array";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_gallery_urls_is_array"
  CHECK (jsonb_typeof("gallery_urls") = 'array');--> statement-breakpoint
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_reviews_is_array";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_reviews_is_array"
  CHECK (jsonb_typeof("reviews") = 'array');--> statement-breakpoint

-- hero_media_type is meaningless without a URL, and unreadable with a value
-- the renderer does not know. Enforced here rather than in the app so the two
-- columns cannot drift apart.
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_hero_media_pair";--> statement-breakpoint
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_hero_media_pair"
  CHECK (
    ("hero_media_url" IS NULL AND "hero_media_type" IS NULL)
    OR ("hero_media_url" IS NOT NULL AND "hero_media_type" IN ('image', 'video'))
  );
