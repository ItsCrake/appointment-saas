/**
 * Moving bookings by hand on the full calendar — the arithmetic, with no
 * React and no DOM.
 *
 * ---------------------------------------------------------------------------
 * **The edit mode's rules, in one place.** `WeekCalendar` turns a pointer, or
 * a key, into minutes and a day; everything it then decides — where the card
 * lands, whether it may land there, what the card looks like while the server
 * is asked — is a function here, tested on integers like the rest of
 * `calendar-layout`.
 *
 * **Five minutes, strictly.** A dragged booking starts on a multiple of five,
 * whatever the pointer's resolution: a 13:07 is a time nobody books and a
 * reader cannot find on the rail, and a finger on a phone cannot aim at a
 * minute anyway.
 *
 * **The ghost warns while the owner still holds the card; a drop is final.**
 * `dropConflict` says what the slot is before release: another live booking
 * of the same provider is a clash, and a time already gone is past — both
 * refused here, the first because the database's
 * `appointments_no_overlap_staff` would refuse it anyway. A block or closed
 * hours is the shop's own policy: the ghost turns amber, and a drop there is
 * the owner's informed decision, saved at once with `force` rather than
 * interrupted by a question. The server still re-checks the clash and the
 * constraint on every write, and an explicit refusal puts the card back.
 * ---------------------------------------------------------------------------
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import {
  MINUTES_PER_DAY,
  minutesToLabel,
  type CalendarItem,
  type GridBounds,
} from "./calendar-layout";
import { shiftDays } from "./calendar-week";
import { planSwap, type SwapRequest, type SwapSide } from "./swap-plan";

/** The grid a dragged booking snaps to, in minutes. */
export const SNAP_MINUTES = 5;

/**
 * Statuses that no longer hold their slot — cancelled, finished, or the client
 * never came. Moving one would resurrect it as a live booking somewhere else,
 * which the action refuses; the calendar does not offer it.
 *
 * `TERMINAL_STATUSES` in `db/schema`, restated because a client component must
 * not import the schema — `calendar-edit.test.ts` fails if the two drift.
 */
export const SETTLED_STATUSES = ["cancelled", "completed", "no_show"] as const;

/** The part of a calendar entry the edit mode reads. */
export type EditableEntry = CalendarItem & {
  kind: "appointment" | "block";
  appointmentId: string | null;
  status: string | null;
  staffId: string | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
};

/** Where a moved booking goes. */
export type EntryMove = {
  appointmentId: string;
  /** Column within the week on screen. */
  dayIndex: number;
  /** "YYYY-MM-DD" of that column. */
  date: string;
  startMinutes: number;
};

/** The nearest multiple of `step` — five minutes unless told otherwise. */
export function snapToGrid(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * The wall-clock minute at a point in a day column.
 *
 * `offsetY` is measured from the column's top edge and `height` is the
 * column's own drawn height, so this holds at every density — including the
 * overview, whose hour only the stylesheet knows.
 */
export function minutesAt(
  offsetY: number,
  height: number,
  bounds: GridBounds,
): number {
  const span = (bounds.endHour - bounds.startHour) * 60;
  if (height <= 0) return bounds.startHour * 60;
  return bounds.startHour * 60 + (offsetY / height) * span;
}

/**
 * Where a dragged booking starts: under the pointer, less where on the card it
 * was picked up, snapped to five minutes and kept inside the hours drawn.
 *
 * `grabOffset` is what makes a drag feel held rather than teleported — a card
 * picked up by its bottom edge stays under the finger by its bottom edge,
 * instead of jumping so its top meets the pointer.
 */
export function dropStart({
  pointerMinutes,
  grabOffset,
  duration,
  bounds,
}: {
  pointerMinutes: number;
  grabOffset: number;
  duration: number;
  bounds: GridBounds;
}): number {
  const first = bounds.startHour * 60;
  const lastEnd = Math.min(bounds.endHour * 60, MINUTES_PER_DAY);
  // The latest start that still ends inside the grid, on the five-minute grid.
  const last = Math.max(
    first,
    Math.floor((lastEnd - duration) / SNAP_MINUTES) * SNAP_MINUTES,
  );
  const snapped = snapToGrid(pointerMinutes - grabOffset);
  return Math.min(last, Math.max(first, snapped));
}

/**
 * Whether this span is the whole booking.
 *
 * A booking that crosses midnight is drawn as one card a day, and each card's
 * minutes are clipped to its own day. Dragging one half would have to decide
 * what happens to the other; the dialog's reschedule answers that properly, so
 * the drag does not try.
 */
function isWholeBooking(entry: EditableEntry): boolean {
  return (
    minutesToLabel(entry.startMinutes) === entry.startTime &&
    minutesToLabel(entry.endMinutes) === entry.endTime
  );
}

/** A live booking that can be picked up and moved or swapped. */
export function canMove(entry: EditableEntry): boolean {
  return (
    entry.kind === "appointment" &&
    entry.appointmentId !== null &&
    entry.status !== null &&
    !(SETTLED_STATUSES as readonly string[]).includes(entry.status) &&
    isWholeBooking(entry)
  );
}

/** Whether a booking holds its provider's time — the constraint's predicate. */
function holdsTime(entry: EditableEntry): boolean {
  return (
    entry.kind === "appointment" &&
    entry.status !== null &&
    !(SETTLED_STATUSES as readonly string[]).includes(entry.status)
  );
}

export type DropConflict =
  /** Another live booking of the same provider — refused. */
  | { kind: "clash"; title: string; startMinutes: number }
  /** A block covers the time — allowed, and said so. */
  | { kind: "blocked"; title: string }
  /** Outside the day's opening hours — allowed, and said so. */
  | { kind: "closed" }
  /** Before now — refused: a drop into the past is almost always a slip. */
  | { kind: "past" };

/**
 * Where "now" falls in the week on screen: today's column and the minute, a
 * column of −1 for a week still ahead (nothing in it is past) and one past the
 * last for a week already gone (everything is).
 */
export type WeekNow = { dayIndex: number; minutes: number };

export function nowInWeek(
  days: readonly string[],
  today: string,
  minutes: number,
): WeekNow | null {
  if (days.length === 0) return null;
  // "YYYY-MM-DD" sorts as it reads.
  if (today < days[0]) return { dayIndex: -1, minutes };
  if (today > days[days.length - 1]) return { dayIndex: days.length, minutes };
  return { dayIndex: days.indexOf(today), minutes };
}

/**
 * What stands in the way of a booking at `target`, if anything — the worst
 * thing first: the past and a clash are refusals, a block or closed hours
 * only a warning.
 *
 * `entries` are the week's own spans (not the day view's remapped copy), and
 * `open` is the target day's opening hours.
 */
export function dropConflict(
  entries: readonly EditableEntry[],
  target: {
    appointmentId: string;
    staffId: string | null;
    dayIndex: number;
    startMinutes: number;
    endMinutes: number;
  },
  open: readonly { startMinutes: number; endMinutes: number }[],
  now: WeekNow | null = null,
): DropConflict | null {
  if (
    now &&
    (target.dayIndex < now.dayIndex ||
      (target.dayIndex === now.dayIndex && target.startMinutes < now.minutes))
  ) {
    return { kind: "past" };
  }

  // Half-open, like the constraint: ending as the next begins is fine.
  const overlaps = (entry: CalendarItem) =>
    entry.dayIndex === target.dayIndex &&
    entry.startMinutes < target.endMinutes &&
    target.startMinutes < entry.endMinutes;

  const clash = entries.find(
    (entry) =>
      holdsTime(entry) &&
      entry.appointmentId !== target.appointmentId &&
      entry.staffId === target.staffId &&
      overlaps(entry),
  );
  if (clash) {
    return {
      kind: "clash",
      title: clash.title,
      startMinutes: clash.startMinutes,
    };
  }

  const block = entries.find(
    (entry) =>
      entry.kind === "block" &&
      (entry.staffId === null || entry.staffId === target.staffId) &&
      overlaps(entry),
  );
  if (block) return { kind: "blocked", title: block.title };

  const inside = open.some(
    (span) =>
      span.startMinutes <= target.startMinutes &&
      target.endMinutes <= span.endMinutes,
  );
  return inside ? null : { kind: "closed" };
}

/**
 * The entry as it will be drawn once the move lands — what the calendar shows
 * while the server is still being asked.
 *
 * The length travels with the booking: the service decides how long somebody
 * sits in the chair, not the slot it is dropped into.
 */
export function movedEntry<T extends EditableEntry>(entry: T, move: EntryMove): T {
  const duration = entry.endMinutes - entry.startMinutes;
  const endMinutes = move.startMinutes + duration;
  return {
    ...entry,
    dayIndex: move.dayIndex,
    date: move.date,
    startMinutes: move.startMinutes,
    endMinutes,
    startTime: minutesToLabel(move.startMinutes),
    endTime: minutesToLabel(endMinutes),
  };
}

/** "10:35" → 635. The times on an entry are always "HH:MM". */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

/* -------------------------------------------------------------------------- */
/* Swapping, planned in the browser                                            */
/* -------------------------------------------------------------------------- */

/**
 * A booking's own instants, from its business-local wall clock.
 *
 * The entry carries the booking's date and times as the shop reads them; a
 * booking that runs past midnight ends on the next day's clock, which is the
 * one case the end time alone cannot say.
 */
export function bookingInstants(
  entry: Pick<EditableEntry, "date" | "startTime" | "endTime">,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = fromZonedTime(`${entry.date}T${entry.startTime}:00`, timezone);
  let endsAt = fromZonedTime(`${entry.date}T${entry.endTime}:00`, timezone);
  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt = fromZonedTime(
      `${shiftDays(entry.date, 1)}T${entry.endTime}:00`,
      timezone,
    );
  }
  return { startsAt, endsAt };
}

/** Where one of the two lands, as the calendar draws it. */
export type CalendarSwapLeg = {
  appointmentId: string;
  clientName: string;
  /** Business-local date and time the booking moves to. */
  date: string;
  time: string;
  startMinutes: number;
  /** Who holds it afterwards — the provider travels with the slot. */
  staffId: string;
};

export type CalendarSwapPlan =
  | {
      ok: true;
      /**
       * Exactly what `swapAppointmentsAction` takes. The server re-plans from
       * its own rows before it writes and refuses unless it lands on the same
       * two times, so a week that changed underneath is refused, never
       * improvised.
       */
      request: SwapRequest;
      legs: [CalendarSwapLeg, CalendarSwapLeg];
      /** They were back to back and swapped order inside their block. */
      repacked: boolean;
    }
  | {
      ok: false;
      /** Which of the two does not fit, and who is already there. */
      clash: {
        leg: "first" | "second";
        who: string;
        needsMinutes: number;
        clientName: string;
        time: string;
      };
    };

/**
 * The swap of two bookings, planned from the week already on screen.
 *
 * ---------------------------------------------------------------------------
 * **The server's plan, computed where the owner is.** Asking the server for a
 * preview cost two and a half seconds before the tray could say anything; the
 * week on screen already holds every booking either one could run into, so
 * the plan is made here with the same `planSwap` and the same two checks as
 * `planSwapFor` — whether anybody sits between two back-to-back bookings, and
 * whom each leg would overlap. `confirmSwap` re-plans from the database before
 * it writes, so this is the answer shown, never the authority.
 *
 * Null when the two cannot be swapped at all — the same booking twice, one no
 * longer live, or one not in this week.
 * ---------------------------------------------------------------------------
 */
export function planCalendarSwap(
  entries: readonly EditableEntry[],
  firstId: string,
  secondId: string,
  timezone: string,
): CalendarSwapPlan | null {
  if (firstId === secondId) return null;

  // One row per booking: a booking crossing midnight is two spans, one booking.
  const bookings = new Map<string, EditableEntry>();
  for (const entry of entries) {
    if (entry.appointmentId && holdsTime(entry) && !bookings.has(entry.appointmentId)) {
      bookings.set(entry.appointmentId, entry);
    }
  }
  const first = bookings.get(firstId);
  const second = bookings.get(secondId);
  if (!first?.staffId || !second?.staffId) return null;

  const side = (entry: EditableEntry, id: string): SwapSide => ({
    id,
    staffId: entry.staffId as string,
    ...bookingInstants(entry, timezone),
  });
  const a = side(first, firstId);
  const b = side(second, secondId);

  const others = [...bookings.entries()]
    .filter(([id]) => id !== firstId && id !== secondId)
    .map(([, entry]) => ({ entry, ...bookingInstants(entry, timezone) }));

  const [earlier, later] =
    a.startsAt.getTime() <= b.startsAt.getTime() ? [a, b] : [b, a];
  const between =
    a.staffId === b.staffId &&
    later.startsAt.getTime() > earlier.endsAt.getTime() &&
    others.some(
      (other) =>
        other.entry.staffId === earlier.staffId &&
        other.startsAt.getTime() < later.startsAt.getTime() &&
        other.endsAt.getTime() > earlier.endsAt.getTime(),
    );

  const plan = planSwap(a, b, { between });
  const minutes = (leg: { startsAt: Date; endsAt: Date }) =>
    Math.round((leg.endsAt.getTime() - leg.startsAt.getTime()) / 60_000);
  const time = (at: Date) => formatInTimeZone(at, timezone, "HH:mm");

  // Half-open, like the constraint — the first booking in the way, by start.
  const inTheWay = (leg: SwapSide) =>
    others
      .filter(
        (other) =>
          other.entry.staffId === leg.staffId &&
          other.startsAt.getTime() < leg.endsAt.getTime() &&
          leg.startsAt.getTime() < other.endsAt.getTime(),
      )
      .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())[0];

  for (const [leg, own, name] of [
    [plan.first, first, "first"],
    [plan.second, second, "second"],
  ] as const) {
    const clash = inTheWay(leg);
    if (clash) {
      return {
        ok: false,
        clash: {
          leg: name,
          who: own.title,
          needsMinutes: minutes(leg),
          clientName: clash.entry.title,
          time: time(clash.startsAt),
        },
      };
    }
  }

  // The two running into each other, with nobody else involved.
  if (
    plan.first.staffId === plan.second.staffId &&
    plan.first.startsAt.getTime() < plan.second.endsAt.getTime() &&
    plan.second.startsAt.getTime() < plan.first.endsAt.getTime()
  ) {
    const firstRuns =
      plan.first.startsAt.getTime() <= plan.second.startsAt.getTime();
    const [runs, into, name] = firstRuns
      ? ([plan.first, second, "first"] as const)
      : ([plan.second, first, "second"] as const);
    return {
      ok: false,
      clash: {
        leg: name,
        who: (firstRuns ? first : second).title,
        needsMinutes: minutes(runs),
        clientName: into.title,
        time: time(firstRuns ? plan.second.startsAt : plan.first.startsAt),
      },
    };
  }

  const view = (
    leg: SwapSide,
    entry: EditableEntry,
    id: string,
  ): CalendarSwapLeg => {
    const at = time(leg.startsAt);
    const [hours, rest] = at.split(":").map(Number);
    return {
      appointmentId: id,
      clientName: entry.title,
      date: formatInTimeZone(leg.startsAt, timezone, "yyyy-MM-dd"),
      time: at,
      startMinutes: hours * 60 + rest,
      staffId: leg.staffId,
    };
  };

  return {
    ok: true,
    request: {
      first: {
        appointmentId: firstId,
        startsAtIso: a.startsAt.toISOString(),
        targetStartsAtIso: plan.first.startsAt.toISOString(),
      },
      second: {
        appointmentId: secondId,
        startsAtIso: b.startsAt.toISOString(),
        targetStartsAtIso: plan.second.startsAt.toISOString(),
      },
    },
    legs: [
      view(plan.first, first, firstId),
      view(plan.second, second, secondId),
    ],
    repacked: plan.repacked,
  };
}
