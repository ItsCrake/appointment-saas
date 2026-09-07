/*
 * HOW ליבי ADDRESSES THE OWNER (0033)
 *
 * ---------------------------------------------------------------------------
 * Hebrew conjugates the second person by gender, so there is no neutral way to
 * say "would you like me to update it" — it is either תרצה or תרצי, and a
 * product that picks one is wrong for roughly half the shops it runs in. Every
 * turn. Out loud.
 *
 * `text` with a default rather than a `pgEnum`, matching `card_style` and
 * `corner_style` next to it: the value is coerced in `libi-config` before it
 * reaches a prompt, so the database is storing a preference rather than
 * enforcing a type, and a new option later is a code change instead of a
 * migration plus a type alter.
 *
 * **Default `'male'`**, which is a decision rather than an absence: an unset
 * column has to say something, and this is what the brief asked for.
 *
 * Ordering: apply BEFORE the code that reads it ships. Drizzle compiles a bare
 * `.select()` into an explicit column list, so a column in `schema.ts` that the
 * database lacks breaks every read of `businesses` — see PROJECT_PLAN §5.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "libi_address_gender" text NOT NULL DEFAULT 'male';
