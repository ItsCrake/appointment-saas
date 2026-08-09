/**
 * The booking flow's step graph, as two pure functions.
 *
 * ---------------------------------------------------------------------------
 * Extracted because the back button was broken here and nothing could see it.
 *
 * `back()` used to reuse `stepAfterSlot` to decide where to return to. For a
 * shop with no staff question that function answers `3` — so back from step 3
 * set the step to 3, and **the button on the final step did nothing at all for
 * every single-staff tenant**, which is most of them. "Where does this slot
 * send you" and "where did you come from" look like the same question and are
 * opposites; only one of them can answer `3`.
 *
 * Pure and separate so the graph is testable without rendering the flow.
 * ---------------------------------------------------------------------------
 */

/**
 * `"staff"` and `"only"` sit between choosing a time and entering details —
 * pick from several free providers, or acknowledge the one free provider — but
 * the stepper still shows three. Picking who performs the service is part of
 * choosing the appointment, not a fourth thing to do.
 */
export type BookingStep = 1 | 2 | "staff" | "only" | 3;

export type StepContext = {
  /**
   * Whether this tenant has a staff question at all: the owner answered yes to
   * the setup question **and** there is currently more than one provider. An
   * owner who flipped the toggle before adding anybody would otherwise get an
   * "only X is available" card on every slot, which says nothing.
   */
  multiStaff: boolean;
  /** Providers free at the chosen slot. */
  freeStaffCount: number;
};

/**
 * Where choosing a slot sends the client.
 *
 * A single-staff tenant resolves **silently** to the details form — the client
 * never learns the concept exists, which is the point of the binary setup
 * question. A tenant that does have a team never skips silently, even when only
 * one person is free: being quietly assigned somebody is the thing worth
 * avoiding, because the client came to a shop with several barbers and has no
 * way to tell they were given the only one left.
 */
export function stepAfterSlot(context: StepContext): BookingStep {
  if (!context.multiStaff) return 3;
  return context.freeStaffCount > 1 ? "staff" : "only";
}

/**
 * Where the back button goes from `current`, or `null` when there is no back.
 *
 * **Never returns `current`.** That is the property the old code violated, and
 * the one the tests assert exhaustively — a back button that lands on the step
 * it started from is indistinguishable from a dead one.
 */
export function previousStep(
  current: BookingStep,
  context: StepContext & { hasSlot: boolean },
): BookingStep | null {
  if (current === 1) return null;
  if (current === 2) return 1;
  if (current === "staff" || current === "only") return 2;

  // From the details form: back to whichever question was actually asked, and
  // straight to the grid when none was.
  if (!context.hasSlot) return 2;
  const asked = stepAfterSlot(context);
  return asked === 3 ? 2 : asked;
}
