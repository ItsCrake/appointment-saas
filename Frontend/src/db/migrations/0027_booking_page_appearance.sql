/*
 * BOOKING PAGE APPEARANCE (0027)
 *
 * ---------------------------------------------------------------------------
 * Four axes an owner can dress `/[slug]` with: the card surface, how soft the
 * corners run, whether services are a list or image cards, and how hard the
 * hero darkens under its text.
 *
 * **Names, not values** — same reasoning as `theme_color` before it. Tailwind
 * cannot build a class from a runtime string, so each of these becomes a
 * `data-*` attribute on the page root and the stylesheet turns it into custom
 * properties. `lib/appearance.ts` owns which names are legal.
 *
 * **Text with defaults rather than enums**, so retiring an option is a code
 * change instead of a migration, and a row still holding a retired name keeps
 * rendering — every coercion in that module falls back rather than throwing.
 *
 * `hero_overlay` is the one genuinely continuous control, because the right
 * value depends on the photograph: a bright shopfront and a dark studio need
 * different answers. Capped in the application at 90 — a setting whose extreme
 * deletes the thing it modifies is a trap, not a range.
 *
 * Every default reproduces exactly what tenants see today, so this migration
 * changes no page until an owner opens the appearance form.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "card_style" text NOT NULL DEFAULT 'elevated',
  ADD COLUMN IF NOT EXISTS "corner_style" text NOT NULL DEFAULT 'rounded',
  ADD COLUMN IF NOT EXISTS "service_layout" text NOT NULL DEFAULT 'compact',
  ADD COLUMN IF NOT EXISTS "hero_overlay" integer NOT NULL DEFAULT 45;
