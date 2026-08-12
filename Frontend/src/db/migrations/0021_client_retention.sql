-- Client win-back: an automated WhatsApp to someone who has not booked in a
-- while and has nothing on the calendar.
--
-- Unlike every other message this product sends, **this one is marketing**. A
-- confirmation, a reminder and a cancellation are all about an appointment the
-- client themselves created; "we have not seen you in a while, want to come
-- in?" is a commercial approach to someone who is not currently a customer.
-- סעיף 30א לחוק התקשורת treats that as דבר פרסומת and requires prior explicit
-- consent, an identifiable sender and a working opt-out.
--
-- Hence three separate things below rather than one flag: the tenant opts in,
-- the client consents, and anyone can be suppressed afterwards. All three are
-- consulted before a single message is queued.

/* ---------------------------------------------------------------------------
   The tenant's own decision. Default false, and it stays false through every
   upgrade: a shop that never asked for this must not start messaging its
   client list because a release shipped.

   It is deliberately not derived from the plan. Being entitled to a feature is
   not the same as having chosen to use it, and this is a feature that speaks
   to the tenant's customers in the tenant's name, over the tenant's own
   WhatsApp number.
--------------------------------------------------------------------------- */
ALTER TABLE "businesses"
  ADD COLUMN "retention_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   The client's decision, captured at booking time.

   On `appointments` rather than a clients table because there is no clients
   table — a "client" in this product is derived from booking history, keyed by
   phone. That has a useful consequence: consent is a snapshot per booking, so
   the *most recent* booking is the current answer, and a client who leaves the
   box unticked next time has withdrawn it without needing a form.

   Default false, never true. Consent that defaults to granted is not consent,
   and a backfill of `true` for existing rows would manufacture it for every
   client who ever booked before this migration ran.
--------------------------------------------------------------------------- */
ALTER TABLE "appointments"
  ADD COLUMN "client_consented_marketing" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   The suppression list, which is what makes the opt-out line in the message
   an actual promise rather than a sentence.

   Keyed on the phone number rather than an appointment: a person opts out, not
   a booking, and the suppression has to outlive every row they appear in —
   including bookings they make later. Scoped per business because consent is
   given to a shop, not to the platform; opting out of one barber must not
   silently opt you out of a clinic you are happy to hear from.
--------------------------------------------------------------------------- */
CREATE TABLE "marketing_opt_outs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_phone" varchar(30) NOT NULL,
  /* Free text: "replied הסר", "asked in the shop". The owner is the one acting
     on it, and a code would only invite a lookup table nobody reads. */
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  /* Idempotency: suppressing someone twice is a no-op, not an error. It is
     also what lets the eligibility query anti-join on a single row. */
  CONSTRAINT "marketing_opt_outs_business_phone_unique"
    UNIQUE ("business_id", "client_phone")
);
--> statement-breakpoint

ALTER TABLE "marketing_opt_outs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

/* Same shape as every other tenant table: one owner policy, no anon policy.
   This one holds bare phone numbers with no name beside them, which is a
   list of people who asked a business to leave them alone. */
CREATE POLICY "owners manage their marketing opt-outs"
  ON "marketing_opt_outs"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "marketing_opt_outs"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "marketing_opt_outs"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  );
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   The notification kind.

   **Nothing in this migration may reference this value.** Postgres will not
   let a value added by `ALTER TYPE` be used in the same transaction that adds
   it, and Drizzle runs every pending migration inside one — so a CHECK, a
   partial index or a default naming `client_winback` here would fail on any
   database applying 0021 alongside anything else. Worse, PGlite executes
   statement by statement and would have passed, so the suite would have proved
   the opposite of production. This is the same trap 0013's inverted predicate
   was written to avoid.

   The code references it at runtime, which is after commit, and is fine.
--------------------------------------------------------------------------- */
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'client_winback';
