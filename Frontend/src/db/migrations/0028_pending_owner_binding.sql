/*
 * PENDING OWNER BINDING (0028)
 *
 * ---------------------------------------------------------------------------
 * A business the platform creates *before* its owner has an account.
 *
 * The operator sets a shop up for a pilot, names the email that will run it,
 * and the binding completes by itself the first time that person signs in.
 *
 * **Why not simply make `owner_user_id` nullable**, which is the honest model
 * for "a business awaiting its owner": the column is NOT NULL today and is read
 * in 29 places that all assume a string, several of them in the operator
 * console's own types. Loosening it is the better shape and a far larger and
 * riskier change than this feature earns. Instead the row is created owned by
 * the **operator who created it**, with the intended email recorded here, and
 * `getBusinessByOwner` ignores any row whose `pending_owner_email` is set — so
 * it never appears as the operator's own shop.
 *
 * Two consequences, both deliberate and both worth knowing:
 *
 * - RLS keeps working untouched. Every policy is `auth.uid() = owner_user_id`,
 *   so while a row is pending it is reachable only by the operator who created
 *   it, and by nobody else on the platform. The moment it is claimed it becomes
 *   the new owner's and the operator loses access, because the same predicate
 *   now resolves to somebody else.
 * - `owner_user_id` references `auth.users` with ON DELETE CASCADE. Deleting
 *   the operator account that created a still-unclaimed business would delete
 *   that business with it. Claimed rows are unaffected. This is the price of
 *   not loosening the column, and it is the first thing to revisit if pending
 *   businesses ever outlive a single onboarding session.
 *
 * The unique index is partial and case-folded: one address can be waiting for
 * exactly one business at a time, which is what makes "claim the business
 * waiting for me" a question with one answer. Claimed rows drop out of the
 * index entirely, so the same address can later be invited to another shop.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "pending_owner_email" text;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "businesses_pending_owner_email_idx"
  ON "businesses" (lower("pending_owner_email"))
  WHERE "pending_owner_email" IS NOT NULL;
