/*
 * WAITLIST OFFER TTL (0025)
 *
 * ---------------------------------------------------------------------------
 * An invite went out and nobody answered. Before this migration that was the
 * end of the slot: the entry sat at `notified` forever, its token stayed live,
 * and the opening it described quietly reached its own start time unsold. The
 * queue behind that one person never heard about it.
 *
 * One column decides how long an offer stays that person's to take. When it
 * lapses the entry goes `expired` and the slot is offered to the next match —
 * see `lib/waitlist-expiry.ts` for the cycle and why `expired` is what stops it
 * looping.
 *
 * **Minutes, not hours.** The thing being measured is the gap between a
 * cancellation and the shop filling it, which is the interval where a slot is
 * worth something; an hours-granular setting could not express the half hour
 * that is the useful answer for most shops.
 *
 * **0 disables it**, matching `reminder_hours_before` directly above it in the
 * table. A shop that would rather an offer never lapse keeps the behaviour it
 * has today, and nothing about this migration is forced on anybody.
 *
 * The default of 60 is deliberately larger than the sweep interval it depends
 * on. Expiry is evaluated by the notifications cron, which is daily on
 * `vercel.json` and driven every fifteen minutes by the GitHub Actions
 * workflow — so a window shorter than about that would be a promise the
 * scheduler cannot keep. See DEPLOYMENT.md §5.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "waitlist_offer_ttl_min" integer NOT NULL DEFAULT 60;
--> statement-breakpoint

/*
 * Partial, because the sweep only ever asks one question: which live offers are
 * past their deadline. `notified` is a small fraction of the table and the
 * other statuses are terminal for this purpose, so indexing them would be
 * paying for rows the query never reads.
 */
CREATE INDEX IF NOT EXISTS "waitlist_entries_notified_invited_at_idx"
  ON "waitlist_entries" ("invited_at")
  WHERE "status" = 'notified';
