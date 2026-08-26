/**
 * Whether a booking lands as a request or as a confirmed appointment (0029).
 *
 * ---------------------------------------------------------------------------
 * **Two flags, OR'd, and the order of that decision is the whole design.**
 *
 * `businesses.requires_approval` is a statement about the *shop*: this owner
 * vets everything. `services.requires_approval` is a statement about one
 * *service*: this treatment is long, expensive or awkward enough to want a word
 * first. A shop that has turned the business-wide flag on must keep vetting
 * every service, or adding a service with the per-service default of `false`
 * would silently switch vetting off for it — a new row quietly weakening a
 * decision the owner made about their whole shop.
 *
 * So the per-service flag can only ever *add* vetting, never remove it. There
 * is deliberately no way to mark a service "always auto-confirm" inside a shop
 * that vets everything: that would be a third state, and the owner asking for
 * it is really asking to turn the shop-wide flag off.
 *
 * Pure, and separate from both call sites, because the public booking flow and
 * the owner's manual booking need the same answer for different reasons — and
 * because "which status does this become" is the kind of rule that gets
 * reimplemented slightly differently the second time it is needed.
 * ---------------------------------------------------------------------------
 */

/** Only the parts of each row the rule reads. */
export type ApprovalInputs = {
  business: { requiresApproval: boolean };
  service: { requiresApproval: boolean };
};

export function requiresApprovalFor({
  business,
  service,
}: ApprovalInputs): boolean {
  return business.requiresApproval || service.requiresApproval;
}

/**
 * The status a *client-made* booking should be created with.
 *
 * `pending` holds the slot exactly as `confirmed` does — it is non-terminal, so
 * the exclusion constraint blocks it. A request that reserved nothing would be
 * a request to be disappointed: somebody else books the time while the owner is
 * deciding.
 *
 * **Not used for the owner's own manual bookings.** An owner entering a walk-in
 * is already agreeing to it; asking them to approve their own booking would be
 * a step with one possible answer. That call site passes `confirmed` directly
 * and does not consult this.
 */
export function bookingStatusFor(
  inputs: ApprovalInputs,
): "pending" | "confirmed" {
  return requiresApprovalFor(inputs) ? "pending" : "confirmed";
}
