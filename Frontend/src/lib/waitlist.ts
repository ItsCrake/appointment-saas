import { formatInTimeZone } from "date-fns-tz";

import type { WaitlistTimeWindow } from "@/db/schema";

/**
 * Who a freed slot should be offered to.
 *
 * ---------------------------------------------------------------------------
 * **Pure, and deliberately so.** Matching is the part of the waitlist that has
 * to be right: it decides who gets messaged about a real appointment, and
 * getting it wrong is either a client told about a slot they cannot use or —
 * worse — a queue that silently skips the person who has waited longest. So it
 * is arithmetic over two plain objects, with no database and no clock of its
 * own, and `waitlist.test.ts` covers every axis independently.
 *
 * The one impure-looking input is the timezone, which is unavoidable: "Tuesday
 * morning" is a statement about the shop's wall clock, and the freed slot
 * arrives as a UTC instant. Resolving that here rather than at the call site
 * keeps the whole rule in one place — the same division the calendar uses.
 * ---------------------------------------------------------------------------
 */

/**
 * The boundaries, in local hours, as half-open ranges.
 *
 * Named windows rather than a time range because that is how somebody actually
 * describes their availability — "mornings are better" — and asking for
 * 09:00–12:30 would be asking the client to do the matching themselves.
 *
 * Noon splits morning from afternoon and 17:00 splits afternoon from evening,
 * which is where an Israeli working day actually bends. A slot is matched on
 * the hour it *starts*: a 16:30 appointment is an afternoon one even if it runs
 * past five, because the client is deciding whether they can be there for it.
 */
export const TIME_WINDOWS = {
  morning: { fromHour: 0, toHour: 12 },
  afternoon: { fromHour: 12, toHour: 17 },
  evening: { fromHour: 17, toHour: 24 },
} as const;

export const TIME_WINDOW_LABELS: Record<WaitlistTimeWindow, string> = {
  morning: "בוקר",
  afternoon: "צהריים",
  evening: "ערב",
  any: "כל שעה",
};

/** Sunday-first, matching `working_hours.weekday` and the rest of the schema. */
export const WEEKDAY_NAMES = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

/** Which window an hour falls in. `any` is never returned — it is a request. */
export function windowForHour(
  hour: number,
): Exclude<WaitlistTimeWindow, "any"> {
  if (hour < TIME_WINDOWS.morning.toHour) return "morning";
  if (hour < TIME_WINDOWS.afternoon.toHour) return "afternoon";
  return "evening";
}

/** A slot that has come free, resolved into the shop's own wall clock. */
export type FreedSlot = {
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  serviceId: string;
};

/** Only the parts of an entry the rule reads. */
export type MatchableEntry = {
  status: string;
  serviceId: string | null;
  preferredStaffId: string | null;
  preferredDays: number[];
  preferredTimeWindow: WaitlistTimeWindow;
};

/** The slot's local weekday and starting hour. */
export function localSlotFacts(slot: FreedSlot, timezone: string) {
  return {
    weekday: Number(formatInTimeZone(slot.startsAt, timezone, "i")) % 7,
    hour: Number(formatInTimeZone(slot.startsAt, timezone, "H")),
  };
}

/**
 * Whether this entry should be offered this slot.
 *
 * **Every preference is a filter, and an absent preference filters nothing.**
 * That asymmetry is the design: somebody who left the service blank wants *any*
 * appointment and should hear about all of them, while somebody who named
 * Tuesday should never be messaged about a Thursday. Reading a blank as "no
 * match" would silently exclude the least fussy clients, who are precisely the
 * ones easiest to place.
 *
 * `notified` entries still match. An offer that went unanswered is not a
 * refusal, and the next cancellation is a fresh chance — the entry only leaves
 * the queue when it is booked, withdrawn or expired.
 */
export function entryMatchesSlot(
  entry: MatchableEntry,
  slot: FreedSlot,
  timezone: string,
): boolean {
  if (entry.status !== "active" && entry.status !== "notified") return false;

  // A named service must be the one that came free; a blank one takes anything.
  if (entry.serviceId && entry.serviceId !== slot.serviceId) return false;

  // Likewise a named provider.
  if (entry.preferredStaffId && entry.preferredStaffId !== slot.staffId) {
    return false;
  }

  const { weekday, hour } = localSlotFacts(slot, timezone);

  if (
    entry.preferredDays.length > 0 &&
    !entry.preferredDays.includes(weekday)
  ) {
    return false;
  }

  if (
    entry.preferredTimeWindow !== "any" &&
    entry.preferredTimeWindow !== windowForHour(hour)
  ) {
    return false;
  }

  return true;
}

/**
 * The queue for one slot, longest wait first.
 *
 * Order matters even though the link is first-come-first-served: it decides who
 * is *told* first when a shop sends to a few people rather than everybody, and
 * "who has waited longest" is the only ordering a client would accept as fair.
 */
export function matchesForSlot<T extends MatchableEntry & { createdAt: Date }>(
  entries: readonly T[],
  slot: FreedSlot,
  timezone: string,
): T[] {
  return entries
    .filter((entry) => entryMatchesSlot(entry, slot, timezone))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** "יום שלישי · בוקר" — how an entry's preferences read on the dashboard. */
export function describePreferences(entry: {
  preferredDays: number[];
  preferredTimeWindow: WaitlistTimeWindow;
}): string {
  const days =
    entry.preferredDays.length === 0
      ? "כל יום"
      : entry.preferredDays
          .slice()
          .sort((a, b) => a - b)
          .map((day) => WEEKDAY_NAMES[day] ?? "")
          .filter(Boolean)
          .map((name) => `יום ${name}`)
          .join(", ");

  return `${days} · ${TIME_WINDOW_LABELS[entry.preferredTimeWindow]}`;
}

/** What an invite link should show. */
export type InviteState = "open" | "taken" | "booked" | "expired";

/** Only the parts of an entry the deadline depends on. */
export type ExpirableOffer = {
  invitedAt: Date | null;
  invitedStartsAt: Date | null;
};

/**
 * The instant an offer stops being this client's to take (0025).
 *
 * ---------------------------------------------------------------------------
 * **The earlier of two deadlines, and both are real.** The shop's window is
 * `invited_at + waitlist_offer_ttl_min`; the slot's own start is the other,
 * because an offer that outlives the appointment it describes is not an offer.
 * A sixty-minute window on a slot that begins in forty minutes has to expire in
 * forty, or the queue behind it never gets the twenty that were left.
 *
 * **0 disables the shop's window**, exactly as it does for
 * `reminder_hours_before` — the slot start still applies, which is the
 * behaviour every existing entry has today. So a tenant who never touches the
 * setting is not silently opted into something new; they are opted into the
 * default the migration gave them, which is a decision the column makes
 * visibly rather than one this function makes behind it.
 *
 * Null means there is nothing to expire: an entry with no slot on it was never
 * offered anything.
 * ---------------------------------------------------------------------------
 */
export function offerDeadline(
  offer: ExpirableOffer,
  offerTtlMin: number,
): Date | null {
  if (!offer.invitedStartsAt) return null;
  if (!offer.invitedAt || offerTtlMin <= 0) return offer.invitedStartsAt;

  const windowEnds = new Date(offer.invitedAt.getTime() + offerTtlMin * 60_000);

  return windowEnds.getTime() < offer.invitedStartsAt.getTime()
    ? windowEnds
    : offer.invitedStartsAt;
}

/** Whether an offer has run out, at a given instant. */
export function offerHasLapsed(
  offer: ExpirableOffer,
  offerTtlMin: number,
  now: Date,
): boolean {
  const deadline = offerDeadline(offer, offerTtlMin);
  return deadline !== null && deadline.getTime() <= now.getTime();
}

/**
 * Which of the four screens `/w/[token]` renders.
 *
 * ---------------------------------------------------------------------------
 * Lives here rather than in the page for two reasons. It is a small state
 * machine with four outcomes and an order that matters — "already yours" has to
 * beat "expired", or somebody who booked the last slot of the day would be told
 * their own appointment had lapsed — which is worth testing on its own. And
 * keeping the clock out of a component's render is the rule React actually
 * wants: `now` is injectable, so the tests pin every boundary instead of
 * depending on when they run.
 * ---------------------------------------------------------------------------
 */
export function inviteStateFor(
  invite: {
    status: string;
    invitedAt: Date | null;
    invitedStartsAt: Date | null;
    invitedEndsAt: Date | null;
  },
  {
    businessIsActive,
    slotTaken,
    offerTtlMin,
  }: {
    businessIsActive: boolean;
    slotTaken: boolean;
    /**
     * The tenant's `waitlist_offer_ttl_min`. Required rather than defaulted,
     * because a default here would be a window this file invented for a shop
     * that configured a different one — and the failure would be silent.
     */
    offerTtlMin: number;
  },
  now: Date = new Date(),
): InviteState {
  // First, because it is the one state that is about *them* rather than about
  // the slot: somebody returning to a link they already used is not late.
  if (invite.status === "booked") return "booked";

  /**
   * The deadline is checked here rather than waited for (0025).
   *
   * The sweep in `waitlist-expiry.ts` is what *cycles* a lapsed offer to the
   * next person, and it runs on the notifications cron — so between the
   * deadline and the next run there is a window of up to fifteen minutes in
   * which the row still says `notified`. Asking the clock directly means the
   * link stops working at the moment it was promised to, rather than at the
   * moment a scheduler happens to notice. The sweep is for progress; this is
   * for correctness, and neither substitutes for the other.
   */
  if (
    !invite.invitedStartsAt ||
    !invite.invitedEndsAt ||
    !businessIsActive ||
    invite.status === "cancelled" ||
    invite.status === "expired" ||
    offerHasLapsed(invite, offerTtlMin, now)
  ) {
    return "expired";
  }

  return slotTaken ? "taken" : "open";
}
