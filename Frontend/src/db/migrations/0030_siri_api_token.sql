/*
 * SIRI API TOKEN (0030)
 *
 * ---------------------------------------------------------------------------
 * A bearer token that lets an owner's phone ask `/api/siri/v1` about their own
 * calendar, so an Apple Shortcut can answer "מה התור הבא שלי?" out loud without
 * a session, a cookie or a login prompt in the middle of a haircut.
 *
 * NULLABLE, AND NULL IS THE DEFAULT. Every existing tenant starts with the
 * feature off and nothing to leak; a token exists only once an owner has
 * pressed the button. That is also what makes revocation trivial — setting the
 * column back to NULL is a full revoke, and there is no second place holding a
 * copy.
 *
 * UNIQUE, because the token *is* the lookup key: the endpoint resolves a
 * business from it and nothing else. A duplicate would be two shops answering
 * to one credential. The index is partial (`WHERE ... IS NOT NULL`) so the
 * hundreds of tenants who never enable this cost nothing to keep unique —
 * Postgres would otherwise treat every NULL as distinct anyway, but a partial
 * index is smaller and says the intent out loud.
 *
 * STORED IN PLAINTEXT, deliberately, and this is the decision worth arguing.
 * A hashed column would survive a database read, but it would also mean the
 * owner can never see the token again after the one moment it is generated —
 * and the whole point of this feature is pasting it into a Shortcut, on a
 * different device, possibly days later. `appointments.cancel_token` already
 * makes the same trade for the same reason. What limits the blast radius is
 * scope rather than storage: this token reads a calendar and can write nothing,
 * `observability.ts` redacts anything whose key matches /token/i before it can
 * reach a log line, and the column sits behind RLS like every other.
 *
 * `siri_token_created_at` is not decoration — it is what the settings panel
 * shows so an owner can tell a token they made this morning from one that has
 * been sitting in a Shortcut since March, which is the only signal they have
 * that it is worth rotating.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "siri_api_token" text,
  ADD COLUMN IF NOT EXISTS "siri_token_created_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "businesses_siri_api_token_key"
  ON "businesses" ("siri_api_token")
  WHERE "siri_api_token" IS NOT NULL;
