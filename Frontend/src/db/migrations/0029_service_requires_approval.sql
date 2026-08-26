/*
 * PER-SERVICE APPROVAL (0029)
 *
 * ---------------------------------------------------------------------------
 * `businesses.requires_approval` is all-or-nothing: a shop either vets every
 * request or none. That is the wrong shape for the case owners actually
 * describe — a barber happy to auto-confirm a 20-minute child's cut but who
 * wants to speak to anyone booking a three-hour colour first.
 *
 * This column narrows the decision to the service being booked. The two are
 * **OR'd, never replaced**: a shop with the business-wide flag on still vets
 * everything, because turning that flag on is a statement about the whole shop
 * and a per-service default of `false` must not quietly switch it off. See
 * `requiresApprovalFor`.
 *
 * `false` by default, so this migration changes no tenant's behaviour until an
 * owner toggles a service. Existing shops keep exactly the flow they have.
 * ---------------------------------------------------------------------------
 */

ALTER TABLE "services"
  ADD COLUMN IF NOT EXISTS "requires_approval" boolean NOT NULL DEFAULT false;
