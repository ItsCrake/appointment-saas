/*
 * PAUSING ONLINE BOOKINGS (0035)
 *
 * ---------------------------------------------------------------------------
 * A switch an owner flips when they need the public page to stop taking
 * bookings for a while — typically on a Friday, while they rebuild next week's
 * hours, and do not want a client landing in a slot that is about to move.
 *
 * **A column rather than hours or time off.** Both of those already stop
 * bookings, and both would be a lie: blocking every open hour tells the page
 * the shop is closed, and the owner is working. This says exactly what is true
 * — the shop is open, the booking page is paused — so the page can say that
 * too, and the owner's own calendar keeps working in full.
 *
 * **Public paths only.** What it stops is everything a client reaches without
 * a session: the slot lookup and the booking on `/[slug]`, and the waitlist's
 * claim link. The owner's manual booking, edit and move, and ליבי, do not read
 * it — an owner pausing the page to reorganise their week is the person who
 * most needs to keep writing to it.
 *
 * `false` by default and never backfilled: every existing shop keeps taking
 * bookings exactly as it did.
 *
 * Ordering: apply BEFORE the code that reads it ships. Drizzle compiles a bare
 * `.select()` on `businesses` into an explicit column list, so a column in
 * `schema.ts` the database lacks breaks `getActiveBusinessBySlug` — the public
 * booking page — and the whole dashboard. See PROJECT_PLAN §5.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "bookings_paused" boolean NOT NULL DEFAULT false;
