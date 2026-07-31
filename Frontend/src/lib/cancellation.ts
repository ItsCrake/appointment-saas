export type AppointmentLike = {
  status: string;
  startsAt: Date;
};

export type CancellationState = {
  isPast: boolean;
  isCancelled: boolean;
  /** Still early enough to cancel without calling the business. */
  withinWindow: boolean;
  /** The only combination that should render a cancel button. */
  canCancel: boolean;
  deadline: Date;
};

/**
 * Single source of truth for "may this booking still be cancelled?", shared by
 * the page (which renders the button) and the server action (which enforces
 * it). Keeping the clock as a parameter makes both testable and keeps
 * `Date.now()` out of component render.
 */
export function getCancellationState(
  appointment: AppointmentLike,
  cancelWindowHours: number,
  now: Date = new Date(),
): CancellationState {
  const startMs = appointment.startsAt.getTime();
  const nowMs = now.getTime();
  const deadline = new Date(startMs - cancelWindowHours * 3_600_000);

  const isPast = startMs < nowMs;
  const isCancelled = appointment.status === "cancelled";
  const withinWindow = nowMs <= deadline.getTime();
  const isOpen =
    appointment.status === "confirmed" || appointment.status === "pending";

  return {
    isPast,
    isCancelled,
    withinWindow,
    canCancel: isOpen && withinWindow && !isPast,
    deadline,
  };
}
