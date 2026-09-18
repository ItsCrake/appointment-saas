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
 * **The client warns; the server decides.** `dropConflict` mirrors the two
 * checks `rescheduleAppointmentAction` makes, so the ghost can turn red or
 * amber *before* the owner lets go: another live booking of the same provider
 * is a clash — refused here, because the database's
 * `appointments_no_overlap_staff` would refuse it anyway — while a block or
 * closed hours is the shop's own policy, which the action asks the owner to
 * confirm rather than refusing. The server re-checks everything regardless;
 * this only makes the answer visible sooner.
 * ---------------------------------------------------------------------------
 */
import {
  MINUTES_PER_DAY,
  minutesToLabel,
  type CalendarItem,
  type GridBounds,
} from "./calendar-layout";

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
  /** A block covers the time — the owner is asked. */
  | { kind: "blocked"; title: string }
  /** Outside the day's opening hours — the owner is asked. */
  | { kind: "closed" };

/**
 * What stands in the way of a booking at `target`, if anything — the worst
 * thing first, since a clash cannot be confirmed away and a block can.
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
): DropConflict | null {
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
