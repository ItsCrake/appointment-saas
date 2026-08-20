/*
 * WAITLIST (0024)
 *
 * ---------------------------------------------------------------------------
 * A shop's calendar fills up and the client goes elsewhere. This is the row that
 * says "I want in, here is roughly when" — so that when somebody cancels, the
 * slot has a queue instead of an empty hole.
 *
 * **Not an appointment.** A waitlist entry reserves nothing, blocks nothing and
 * appears nowhere in availability. That is why it is its own table rather than
 * another `appointments.status`: every query in the product that counts, blocks
 * or bills treats an appointment row as a commitment, and a wish is not one.
 *
 * The invite columns at the bottom are what make the race in §4 work — see the
 * note above them.
 * ---------------------------------------------------------------------------
 */

CREATE TYPE "waitlist_status" AS ENUM (
  'active',    -- waiting, and eligible to be offered a freed slot
  'notified',  -- offered one; the token below is live
  'booked',    -- took a slot, and must stop receiving offers
  'expired',   -- the shop let it lapse
  'cancelled'  -- withdrawn, by the client or the owner
);
--> statement-breakpoint

/*
 * Coarse on purpose. "Morning or evening" is how somebody actually describes
 * their availability to a receptionist; asking for a time range would be asking
 * them to do the matching themselves. The boundaries live in `lib/waitlist.ts`
 * so the UI, the matcher and the tests cannot disagree about when noon is.
 */
CREATE TYPE "waitlist_time_window" AS ENUM (
  'morning',
  'afternoon',
  'evening',
  'any'
);
--> statement-breakpoint

CREATE TABLE "waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_name" text NOT NULL,
  "client_phone" varchar(30) NOT NULL,
  /*
   * NULL means "any service". A client who just wants to get in should not have
   * to pick from a menu, and a shop with one service would be asking a question
   * with one answer.
   *
   * RESTRICT rather than CASCADE, matching `appointments.service_id`: a service
   * with people waiting on it is not deletable, only deactivatable.
   */
  "service_id" uuid REFERENCES "services"("id") ON DELETE RESTRICT,
  /* NULL means "anyone". SET NULL rather than CASCADE — losing the preference
     is right when a provider leaves; losing the person's place in the queue is
     not. */
  "preferred_staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  /*
   * Weekdays as integers, 0 = Sunday, in a JSON array. An empty array means any
   * day.
   *
   * Integers rather than names ('sunday') because every other weekday in this
   * schema is a `smallint` on the same 0–6 basis — `working_hours.weekday`,
   * `staff_schedules.weekday` — and a second representation would need
   * translating at every boundary, which is exactly where a Sunday-versus-Monday
   * off-by-one gets in.
   */
  "preferred_days" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "preferred_time_window" "waitlist_time_window" NOT NULL DEFAULT 'any',
  "status" "waitlist_status" NOT NULL DEFAULT 'active',
  /* What the client typed, if anything. Same role as `appointments.notes`. */
  "notes" text,

  /* ---- The invite, and the race it has to survive ---------------------- *
   *
   * One freed slot is offered to several people at once, so the offer cannot
   * live on the slot — it lives here, once per entry, each with its own token.
   * That is what lets `/w/[token]` know *who* is booking, mark exactly that
   * entry `booked`, and show everyone who arrives second a state that names
   * what happened rather than a generic error.
   *
   * The slot is copied rather than referenced because it no longer exists as a
   * row: the appointment that held it was cancelled, and the whole point is
   * that the time is now free.
   */
  "invite_token" text UNIQUE,
  "invited_at" timestamptz,
  "invited_starts_at" timestamptz,
  "invited_ends_at" timestamptz,
  "invited_staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  "invited_service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

/* The matcher's own query: active entries for one shop. */
CREATE INDEX "waitlist_entries_business_status_idx"
  ON "waitlist_entries" ("business_id", "status");
--> statement-breakpoint

/* The dashboard lists newest first. */
CREATE INDEX "waitlist_entries_business_created_idx"
  ON "waitlist_entries" ("business_id", "created_at" DESC);
--> statement-breakpoint

/*
 * One live entry per person per shop, enforced rather than checked in the
 * action: a client who taps "join" twice, or joins again a week later while
 * still waiting, should hold one place in the queue and not two. Partial, so it
 * only constrains entries that are still waiting — the same person may join
 * again after a previous entry was booked or cancelled.
 */
CREATE UNIQUE INDEX "waitlist_entries_one_live_per_client"
  ON "waitlist_entries" ("business_id", "client_phone")
  WHERE "status" IN ('active', 'notified');
--> statement-breakpoint

ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

/*
 * Same shape as every other tenant table: one owner policy, no anon policy.
 *
 * The public join form writes through the server's service role, exactly as a
 * public booking does — `anon` never touches this table, so a client cannot
 * read the queue they are joining or discover who else is on it.
 */
CREATE POLICY "owners manage their waitlist"
  ON "waitlist_entries"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "waitlist_entries"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "waitlist_entries"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  );
--> statement-breakpoint

/*
 * When the slot was given up.
 *
 * The freed-slot banner needs "cancelled recently", and a cancelled row carried
 * no such timestamp — only `created_at`, which is when it was booked. Without
 * this, an appointment cancelled months ago for a date still in the future would
 * be offered to the waitlist as fresh news.
 *
 * Nullable and never backfilled: existing cancellations genuinely do not have a
 * known time, and inventing `now()` for them would announce every historical
 * cancellation at once on the first deploy.
 */
ALTER TABLE "appointments"
  ADD COLUMN "cancelled_at" timestamptz;
--> statement-breakpoint

CREATE INDEX "appointments_cancelled_at_idx"
  ON "appointments" ("business_id", "cancelled_at")
  WHERE "cancelled_at" IS NOT NULL;
--> statement-breakpoint

/*
 * Which waiting client an outbox row is for.
 *
 * A waitlist invite has no appointment — the whole point is that the slot is
 * empty — so `appointment_id` cannot carry it, and the dispatcher needs the
 * entry to know who is being written to and which slot is being offered. Same
 * shape and same cascade as `appointment_id` beside it.
 */
ALTER TABLE "notifications"
  ADD COLUMN "waitlist_entry_id" uuid
    REFERENCES "waitlist_entries"("id") ON DELETE CASCADE;
--> statement-breakpoint

/*
 * The invite is a real message and goes through the outbox like every other, so
 * it is counted, retried and visible in `/master` alongside the rest.
 *
 * There is no approved Meta template for this kind yet, so on the official
 * WhatsApp path it will be refused rather than sent — the same state the five
 * drafted kinds are in. That is deliberate: the row is still written, the owner
 * still gets a link they can send by hand, and the moment a template exists this
 * starts delivering with no further change.
 */
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'waitlist_invite';
