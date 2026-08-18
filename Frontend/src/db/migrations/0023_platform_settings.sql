-- The first row in this database that belongs to the *platform* rather than to
-- a tenant.
--
-- Everything else here is per-business by construction: RLS is written around
-- `business_id`, and the one cross-tenant module (`queries/admin.ts`) reads
-- tenant rows rather than owning any. This table owns one operational switch
-- that has no business_id to hang on, because it is about what the platform
-- does, not what a shop configured.
--
-- **Single row, enforced.** `id` is a fixed constant with a CHECK, so there is
-- no "which settings row is live" question to get wrong later, and a second
-- INSERT fails loudly instead of silently shadowing the first.
--
-- No RLS policies, deliberately. Every other table has owner policies keyed on
-- `business_id`; this one has no owner and must never be readable by `anon`.
-- RLS is enabled with zero policies, which denies everyone — the service role
-- used by the server bypasses RLS, and that is the only thing that should read
-- it.

CREATE TABLE "platform_settings" (
  "id" boolean PRIMARY KEY DEFAULT true,
  /*
   * The WhatsApp cost guard, from the console rather than the environment.
   *
   * `DISABLE_WHATSAPP_DISPATCH` already exists and stays: it is the deploy-time
   * guard, and `check:env --production` refuses to ship with it set. This is the
   * runtime one, flippable from /master without a redeploy.
   *
   * The two combine by OR, never by override. Either source can suppress
   * sending; neither can force it back on over the other. That direction is the
   * point — a switch in a web UI must not be able to start spending money on a
   * deploy whose environment deliberately said no.
   */
  "whatsapp_dispatch_disabled" boolean NOT NULL DEFAULT false,
  /* Who flipped it last, for the same reason impersonation is audited. */
  "updated_by" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_settings_single_row" CHECK ("id" = true)
);

ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;

-- Seed the one row so every read is a plain SELECT rather than an upsert.
INSERT INTO "platform_settings" ("id") VALUES (true);
