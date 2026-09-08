/*
 * WHERE AN APPOINTMENT CAME FROM (0034)
 *
 * ---------------------------------------------------------------------------
 * Three routes write a booking and the calendar cannot tell them apart: a
 * client on the public page, the owner in the manual dialog, and ליבי from a
 * spoken sentence. That last one matters most to see — it is the newest path,
 * the one an owner is still learning to trust, and the one where "did that
 * actually go in?" is a question worth answering at a glance rather than by
 * opening the card.
 *
 * **`text` rather than a boolean, and a route rather than a flag.**
 * `created_by_livi` would answer one question and close the door on the next:
 * a calendar that distinguishes voice from manual from online is the same
 * column doing three jobs, and "which of these did I book myself" is a
 * question an owner asks about a full week. Coerced in `lib/appointment-origin`
 * before it is rendered, so the database stores a preference and an unknown
 * value reads as the default rather than breaking a card.
 *
 * **`'online'` as the default is a decision, not an absence.** Every existing
 * row predates this column and the overwhelming majority of them are public
 * bookings; the demo seeds are the exception and they are not worth a backfill
 * that would have to guess.
 *
 * Distinct from `is_voice_placeholder` (0032), which answers a different
 * question — that one means *no phone number was dictated*, and a voice booking
 * with a number is an ordinary contactable client that still deserves the
 * microphone on its card.
 *
 * Ordering: apply BEFORE the code that reads it ships. Drizzle compiles a bare
 * `.select()` into an explicit column list, so a column in `schema.ts` the
 * database lacks breaks every read of `appointments`. See PROJECT_PLAN §5.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "created_via" text NOT NULL DEFAULT 'online';
