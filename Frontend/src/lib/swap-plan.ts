/**
 * What swapping two appointments means, as arithmetic — no database, no
 * React, safe in a browser.
 *
 * Split out of `appointment-swap` so the full calendar can plan a swap from
 * the week already on screen, instantly, with the very function the server
 * re-plans with before it writes (`confirmSwap`). The two cannot disagree
 * about what a swap of two different lengths means, because there is one
 * answer, here. The rules themselves are explained at the top of
 * `appointment-swap`.
 */

/** The part of an appointment a swap needs. */
export type SwapSide = {
  id: string;
  staffId: string;
  startsAt: Date;
  endsAt: Date;
};

/** Where one appointment goes. */
export type SwapLeg = {
  id: string;
  staffId: string;
  startsAt: Date;
  endsAt: Date;
};

export type SwapPlan = {
  /** Where the appointment named first goes. */
  first: SwapLeg;
  /** Where the appointment named second goes. */
  second: SwapLeg;
  /**
   * The two were back to back and swapped order inside their block, so at
   * least one of them does not start where the other one used to. Said out
   * loud, because it is a time nobody asked for.
   */
  repacked: boolean;
};

/**
 * The widest gap between two bookings that still counts as back to back.
 *
 * A booking-page buffer puts five or ten minutes between clients who are, as
 * far as anybody in the shop is concerned, one after the other. Past a quarter
 * of an hour the gap is somebody's break, and carrying it into the middle of a
 * re-ordered block would move the break rather than keep it.
 */
export const BACK_TO_BACK_GAP_MIN = 15;

const minutes = (ms: number) => Math.round(ms / 60_000);

/**
 * The plan for two appointments, given whether anything else sits between
 * them on their provider.
 *
 * Pure: `between` is the one fact that needs the database, and the caller
 * supplies it — see {@link planSwapFor}.
 */
export function planSwap(
  first: SwapSide,
  second: SwapSide,
  { between }: { between: boolean },
): SwapPlan {
  const [earlier, later] =
    first.startsAt.getTime() <= second.startsAt.getTime()
      ? [first, second]
      : [second, first];

  const gapMs = later.startsAt.getTime() - earlier.endsAt.getTime();
  const backToBack =
    first.staffId === second.staffId &&
    !between &&
    gapMs >= 0 &&
    minutes(gapMs) <= BACK_TO_BACK_GAP_MIN;

  if (backToBack) {
    const laterLength = later.endsAt.getTime() - later.startsAt.getTime();
    const earlierLength = earlier.endsAt.getTime() - earlier.startsAt.getTime();

    const movedLater: SwapLeg = {
      id: later.id,
      staffId: later.staffId,
      startsAt: earlier.startsAt,
      endsAt: new Date(earlier.startsAt.getTime() + laterLength),
    };
    const movedEarlier: SwapLeg = {
      id: earlier.id,
      staffId: earlier.staffId,
      startsAt: new Date(movedLater.endsAt.getTime() + gapMs),
      endsAt: later.endsAt,
    };

    const [firstLeg, secondLeg] =
      earlier.id === first.id
        ? [movedEarlier, movedLater]
        : [movedLater, movedEarlier];

    return {
      first: firstLeg,
      second: secondLeg,
      repacked: laterLength !== earlierLength,
    };
  }

  const length = (side: SwapSide) =>
    side.endsAt.getTime() - side.startsAt.getTime();

  return {
    first: {
      id: first.id,
      staffId: second.staffId,
      startsAt: second.startsAt,
      endsAt: new Date(second.startsAt.getTime() + length(first)),
    },
    second: {
      id: second.id,
      staffId: first.staffId,
      startsAt: first.startsAt,
      endsAt: new Date(first.startsAt.getTime() + length(second)),
    },
    repacked: false,
  };
}

/** What a confirmed swap has to be checked against. */
export type SwapRequest = {
  first: { appointmentId: string; startsAtIso: string; targetStartsAtIso: string };
  second: { appointmentId: string; startsAtIso: string; targetStartsAtIso: string };
};
