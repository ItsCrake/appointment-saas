-- Social profiles on the public booking page.
--
-- Five columns rather than one jsonb blob, which is the opposite of the choice
-- `gallery_urls` and `reviews` made in 0009 — and for the reason stated there.
-- Those are *lists* whose order is their meaning, with no fixed shape. These
-- are five named, single-valued fields: columns make each one queryable, let a
-- CHECK reject a value that would render as a broken link, and mean the public
-- page reads a string instead of parsing and re-validating a document.

ALTER TABLE "businesses" ADD COLUMN "social_instagram" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "social_facebook" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "social_tiktok" text;
--> statement-breakpoint
-- Stored as a phone number, not a URL: an owner types the number they already
-- know, and `lib/social-links.ts` builds the wa.me link. Asking for a URL is
-- how you get half a tenant base pasting a chat export.
ALTER TABLE "businesses" ADD COLUMN "social_whatsapp" text;
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "website_url" text;
--> statement-breakpoint

-- Length only. The *shape* is enforced in `lib/social-links.ts`, which
-- normalises on write and re-validates on read — the same posture as the
-- branding columns, and for the same reason: a seed or a psql session can write
-- past the app, and the public page has to render regardless.
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_social_length_check"
  CHECK (
    coalesce(length("social_instagram"), 0) <= 200
    AND coalesce(length("social_facebook"), 0) <= 200
    AND coalesce(length("social_tiktok"), 0) <= 200
    AND coalesce(length("social_whatsapp"), 0) <= 40
    AND coalesce(length("website_url"), 0) <= 300
  );
