import { and, asc, eq, gt, inArray, lt, notInArray } from "drizzle-orm";

import {
  BLOCKING_STATUSES,
  getAppointment,
  swapAppointments,
} from "@/db/queries/appointments";
import { appointments } from "@/db/schema";
import type { Database } from "@/db/types";

import {
  planSwap,
  type SwapLeg,
  type SwapPlan,
  type SwapRequest,
  type SwapSide,
} from "./swap-plan";

const minutes = (ms: number) => Math.round(ms / 60_000);

/**
 * Swapping two appointments: what "swap" means when the two are not the same
 * length, and whether it fits.
 *
 * ---------------------------------------------------------------------------
 * **Each takes the other's place — start time and provider together.** A swap
 * is the calendar's two cards changing places, so the provider travels with
 * the slot: in a two-chair shop, the client who was in the 15:00 with מאיה is
 * in the 15:00 with מאיה afterwards. Keeping providers and swapping only times
 * would need each provider free at the other's hour, which in a busy shop they
 * almost never are. Whoever the provider becomes is *said* when it changes —
 * see the sentence in `libi-tools` — so nobody is reassigned silently.
 *
 * **The length stays with the appointment, never with the slot.** A 60-minute
 * colour moved into a 30-minute haircut's slot still needs 60 minutes; the
 * service decides how long somebody sits in the chair, not the time they were
 * given. That is the whole difficulty, and there are exactly two answers to
 * it:
 *
 * - **Back to back on one provider, they swap order inside their block.** The
 *   later one starts where the earlier one started and the earlier one follows
 *   after the same gap, ending where the later one ended. The block the two
 *   filled is filled again, exactly — nothing can overlap a third booking and
 *   no hole opens in the day. A plain exchange of start times there would
 *   either overlap (the longer one runs into the shorter one's successor) or
 *   leave a hole the length of the difference, which is the "invalid gap" an
 *   owner looking at the booking page would see.
 * - **Anywhere else, each takes the other's start**, and the fit is checked
 *   against everything else that provider holds. If it does not fit, the swap
 *   is refused *before* anybody is asked to confirm it, and the refusal names
 *   who is in the way — the same standard every other write here meets.
 *
 * The overlap guard is still the database's: this module decides what to ask
 * for, and `swapAppointments` performs it inside a transaction the constraint
 * watches.
 * ---------------------------------------------------------------------------
 */

export {
  BACK_TO_BACK_GAP_MIN,
  planSwap,
  type SwapLeg,
  type SwapPlan,
  type SwapRequest,
  type SwapSide,
} from "./swap-plan";

/** Whom a leg would run into, when it does not fit. */
export type SwapClash = {
  /** Which appointment does not fit: the one named first, or second. */
  leg: "first" | "second";
  /** How long that appointment needs, in minutes. */
  needsMinutes: number;
  /** Who is already there. */
  clientName: string;
  startsAt: Date;
};

export type SwapPlanResult =
  | { ok: true; plan: SwapPlan }
  | { ok: false; clash: SwapClash };

/**
 * Whether any other live booking of this provider starts between the two.
 *
 * Only asked when they share a provider and are close enough to be back to
 * back; everywhere else the answer cannot change the plan.
 */
async function bookedBetween(
  db: Database,
  businessId: string,
  earlier: SwapSide,
  later: SwapSide,
): Promise<boolean> {
  if (later.startsAt.getTime() <= earlier.endsAt.getTime()) return false;

  const [row] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.staffId, earlier.staffId),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        notInArray(appointments.id, [earlier.id, later.id]),
        lt(appointments.startsAt, later.startsAt),
        gt(appointments.endsAt, earlier.endsAt),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** The first live booking, other than the two, that a leg would overlap. */
async function legClash(
  db: Database,
  businessId: string,
  leg: SwapLeg,
  exclude: readonly string[],
) {
  const [row] = await db
    .select({
      clientName: appointments.clientName,
      startsAt: appointments.startsAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.businessId, businessId),
        eq(appointments.staffId, leg.staffId),
        inArray(appointments.status, [...BLOCKING_STATUSES]),
        notInArray(appointments.id, [...exclude]),
        // Half-open, like the constraint: ending as the next begins is fine.
        lt(appointments.startsAt, leg.endsAt),
        gt(appointments.endsAt, leg.startsAt),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(1);

  return row ?? null;
}

/**
 * The plan for two appointments as they stand, or the booking in the way.
 *
 * The two are checked against each other as well as against everything else:
 * two bookings more than a quarter of an hour apart with nothing between them
 * exchange start times, and the longer one can then run into the shorter one's
 * new place — a clash no third booking is involved in.
 */
export async function planSwapFor(
  db: Database,
  businessId: string,
  first: SwapSide & { clientName: string },
  second: SwapSide & { clientName: string },
): Promise<SwapPlanResult> {
  const [earlier, later] =
    first.startsAt.getTime() <= second.startsAt.getTime()
      ? [first, second]
      : [second, first];

  const between =
    first.staffId === second.staffId &&
    (await bookedBetween(db, businessId, earlier, later));

  const plan = planSwap(first, second, { between });
  const exclude = [first.id, second.id];

  const [firstClash, secondClash] = await Promise.all([
    legClash(db, businessId, plan.first, exclude),
    legClash(db, businessId, plan.second, exclude),
  ]);

  const needs = (leg: SwapLeg) =>
    minutes(leg.endsAt.getTime() - leg.startsAt.getTime());

  if (firstClash) {
    return {
      ok: false,
      clash: { leg: "first", needsMinutes: needs(plan.first), ...firstClash },
    };
  }
  if (secondClash) {
    return {
      ok: false,
      clash: { leg: "second", needsMinutes: needs(plan.second), ...secondClash },
    };
  }

  const sameChair = plan.first.staffId === plan.second.staffId;
  const overlap =
    sameChair &&
    plan.first.startsAt.getTime() < plan.second.endsAt.getTime() &&
    plan.second.startsAt.getTime() < plan.first.endsAt.getTime();

  if (overlap) {
    // Whichever starts first runs into the other one.
    const [runs, into, leg] =
      plan.first.startsAt.getTime() <= plan.second.startsAt.getTime()
        ? ([plan.first, second, "first"] as const)
        : ([plan.second, first, "second"] as const);
    return {
      ok: false,
      clash: {
        leg,
        needsMinutes: needs(runs),
        clientName: into.clientName,
        startsAt: leg === "first" ? plan.second.startsAt : plan.first.startsAt,
      },
    };
  }

  return { ok: true, plan };
}

export type SwapConfirmation =
  | { ok: true; rows: readonly [SwapRow, SwapRow] }
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "clash"; clash: SwapClash; firstName: string; secondName: string };

type SwapRow = NonNullable<Awaited<ReturnType<typeof getAppointment>>>;

/**
 * Performs a swap the owner has agreed to — if it is still the swap they
 * agreed to.
 *
 * ---------------------------------------------------------------------------
 * **Re-planned from the rows as they are now, and compared with what was
 * said.** The request arrives from the browser — as a spoken "כן" or a tapped
 * button — and describes a question asked seconds ago. Both rows are re-read
 * under this tenant, both must still start where they did, and the plan made
 * from them now must land exactly where the question said. A booking that
 * appeared between them in the meantime changes the plan, and a changed plan
 * is a different question: refused, not applied.
 * ---------------------------------------------------------------------------
 */
export async function confirmSwap(
  db: Database,
  businessId: string,
  request: SwapRequest,
): Promise<SwapConfirmation> {
  if (request.first.appointmentId === request.second.appointmentId) {
    return { ok: false, reason: "stale" };
  }

  const [first, second] = await Promise.all([
    getAppointment(db, businessId, request.first.appointmentId),
    getAppointment(db, businessId, request.second.appointmentId),
  ]);
  if (!first || !second) return { ok: false, reason: "stale" };

  const asAsked = (row: SwapRow, asked: SwapRequest["first"]) =>
    BLOCKING_STATUSES.includes(row.status) &&
    row.startsAt.toISOString() === asked.startsAtIso;

  if (!asAsked(first, request.first) || !asAsked(second, request.second)) {
    return { ok: false, reason: "stale" };
  }

  const result = await planSwapFor(db, businessId, first, second);
  if (!result.ok) {
    return {
      ok: false,
      reason: "clash",
      clash: result.clash,
      firstName: first.clientName,
      secondName: second.clientName,
    };
  }

  const { plan } = result;
  if (
    plan.first.startsAt.toISOString() !== request.first.targetStartsAtIso ||
    plan.second.startsAt.toISOString() !== request.second.targetStartsAtIso
  ) {
    return { ok: false, reason: "stale" };
  }

  const rows = await swapAppointments(db, businessId, [
    { ...plan.first, fromStartsAt: first.startsAt },
    { ...plan.second, fromStartsAt: second.startsAt },
  ]);

  return rows ? { ok: true, rows } : { ok: false, reason: "stale" };
}
