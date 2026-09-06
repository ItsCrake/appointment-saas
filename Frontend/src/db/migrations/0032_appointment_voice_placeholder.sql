/*
 * VOICE PLACEHOLDER APPOINTMENTS (0032)
 *
 * ---------------------------------------------------------------------------
 * ליבי can now book a slot from a spoken sentence, and the owner is not going
 * to dictate a phone number to do it. So a placeholder is a real appointment
 * row — it holds the time, it is non-terminal, and the exclusion constraint
 * blocks an online client from taking the slot underneath it — with `false`
 * where a number would be and this flag saying why.
 *
 * **The flag exists because `client_phone` is `NOT NULL` and the clients list
 * groups by it.** A placeholder stores an empty string there, and without a way
 * to tell those rows apart every voice booking in the shop would collapse into
 * one phantom client in `listClients` whose visit count climbed every time the
 * owner spoke. Widening `client_phone` to nullable would have meant touching
 * every read of the column instead; one boolean is the smaller change and it
 * also names the concept, which a sentinel empty string does not.
 *
 * **Ordering: apply this BEFORE the code that reads it ships.** Drizzle
 * compiles a bare `.select()` into an explicit column list, so a column that is
 * in `schema.ts` and not in the database breaks *every* read of `appointments`
 * — the calendar, the agenda, the reminders cron. See PROJECT_PLAN §5. This is
 * the direction 0031 was allowed to ignore, because a drop is safe either way
 * and an add is not.
 *
 * `DEFAULT false` and `NOT NULL` together, so the backfill is the default and
 * every existing row is what it has always been: an appointment somebody made
 * with a phone number attached.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "appointments"
  ADD COLUMN IF NOT EXISTS "is_voice_placeholder" boolean NOT NULL DEFAULT false;
