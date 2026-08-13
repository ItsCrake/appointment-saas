-- The first thing in this product that is a *client record* rather than a
-- consequence of one.
--
-- Everything about a client has so far been derived: the clients list is a
-- `GROUP BY client_phone` over appointment history, and the name shown is
-- whichever they typed most recently. That works because every fact about them
-- is already a fact about a booking.
--
-- A preference is not. "Prefers the 3rd chair", "always late, don't chase",
-- "allergic to the blue dye" — none of it belongs to any one appointment, and
-- writing it onto the most recent booking would attach it to a row that scrolls
-- out of view and eventually gets cancelled.
--
-- **Keyed on (business_id, client_phone), which is the identity this product
-- already uses.** A phone number is what a booking carries, what the client
-- lookup at `/[slug]/my-appointments` searches, and what the win-back campaign
-- groups by. Keying on a name instead would merge two different people called
-- דני and split one person who typed their name differently twice.
--
-- Per business, not per platform. Two shops seeing each other's notes about a
-- shared customer is a data leak dressed as a feature, and the note one barber
-- writes is meaningless to a clinic.

CREATE TABLE "client_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "client_phone" varchar(30) NOT NULL,
  /*
   * Free text on purpose. The owner is writing for themselves, in their own
   * shorthand, and any structure imposed here would be a form they have to
   * learn instead of a box they can type in.
   */
  "notes" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  /*
   * One profile per person per shop. It is also what makes the write an upsert
   * rather than a read-then-insert, which two tabs open on the same client
   * would otherwise race.
   */
  CONSTRAINT "client_profiles_business_phone_unique"
    UNIQUE ("business_id", "client_phone")
);
--> statement-breakpoint

ALTER TABLE "client_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

/* Same shape as every other tenant table: one owner policy, no anon policy.
   This one holds a phone number next to a sentence somebody wrote about a
   named individual, which is the most sensitive pairing in the schema. */
CREATE POLICY "owners manage their client profiles"
  ON "client_profiles"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "client_profiles"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "client_profiles"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  );
