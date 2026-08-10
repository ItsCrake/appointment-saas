-- Web push subscriptions for business owners.
--
-- One row per *device*, not per owner: a shop is routinely run from a phone and
-- a laptop, and an owner who enables notifications on both expects both to
-- buzz. The endpoint is the device's identity as far as the push service is
-- concerned, so it is the natural key.

CREATE TABLE "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  /*
   * The push service's URL for this device. Unique globally rather than per
   * business: a browser hands out one endpoint per registration, so the same
   * value appearing under two tenants would mean one of them is wrong. The
   * upsert on this column is what makes re-subscribing idempotent.
   */
  "endpoint" text NOT NULL UNIQUE,
  /* Keys from the browser's PushSubscription, needed to encrypt the payload. */
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  /* Shown in settings so an owner can tell which device they are looking at. */
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  /*
   * Set when the push service reports the subscription gone (404/410). Kept
   * rather than deleted so a sweep can report how many devices lapsed, and
   * cleared if the same endpoint ever subscribes again.
   */
  "expired_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX "push_subscriptions_business_idx"
  ON "push_subscriptions" ("business_id")
  WHERE "expired_at" IS NULL;
--> statement-breakpoint

/* ---------------------------------------------------------------------------
   RLS, matching every other tenant table: on, with one owner policy.

   Nothing in the app reads this through PostgREST — the dispatcher uses the
   pooled connection — but the anon key is public, and a table without RLS is
   readable by anyone who knows its name. A push endpoint is not a credential,
   yet it is a URL that lets a stranger buzz someone's phone.
--------------------------------------------------------------------------- */
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "owners manage their push subscriptions"
  ON "push_subscriptions"
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "push_subscriptions"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "businesses" b
      WHERE b."id" = "push_subscriptions"."business_id"
        AND b."owner_user_id" = auth.uid()
    )
  );
--> statement-breakpoint

/* Owner opt-in. Separate from the subscription rows because a device can be
   registered while the owner has notifications switched off, and turning them
   back on should not require granting browser permission again. */
ALTER TABLE "businesses"
  ADD COLUMN "push_enabled" boolean NOT NULL DEFAULT false;
