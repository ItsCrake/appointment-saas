import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import {
  getBusinessById,
  getService,
  listAppointmentsInRange,
  listServices,
  listTimeOffInRange,
  listWorkingHoursForWeekday,
} from "@/db/queries";
import {
  listActiveStaff,
  listStaffSchedulesForWeekday,
  primaryStaff,
} from "@/db/queries/staff";
import type { Database } from "@/db/types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type Slot = {
  /** UTC instant, ISO-8601. The only value the client should send back. */
  startsAt: string;
  endsAt: string;
  /** "HH:mm" in the business timezone, ready to render. */
  label: string;
};

/** Only the fields the engine needs — keeps the pure function easy to call. */
export type AvailabilityBusiness = {
  timezone: string;
  slotIntervalMin: number;
  bufferMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
};

export type AvailabilityShift = {
  startTime: string;
  endTime: string;
  isClosed: boolean;
};

export type BusyInterval = { startsAt: Date; endsAt: Date };

export type ComputeSlotsInput = {
  business: AvailabilityBusiness;
  /** Service length in minutes. */
  durationMin: number;
  /** Per-service gap override; null/undefined inherits the business value. */
  serviceBufferMin?: number | null;
  /** Shifts for the requested weekday. Empty means a closed day. */
  shifts: AvailabilityShift[];
  appointments: BusyInterval[];
  timeOff: BusyInterval[];
  /** Calendar date in the business timezone, "YYYY-MM-DD". */
  date: string;
  now: Date;
  /**
   * How starts are placed inside each free window. Defaults to `dense`, which
   * is what a single-chair shop wants and what every caller did before the
   * grid existed.
   */
  packing?: SlotPacking;
};

/** Day of week (0 = Sunday) for a plain "YYYY-MM-DD" calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Half-open `[start, end)` in epoch milliseconds. */
export type Interval = { start: number; end: number };

/**
 * Union of overlapping or touching intervals, sorted by start.
 *
 * Touching counts as one (`cur.start <= last.end`, not `<`): two bookings that
 * meet exactly at 10:00 leave no free time between them, and emitting a
 * zero-length window there would put a candidate at an instant that is not
 * actually free.
 */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Everything in `base` that is not covered by `blocked`. */
export function subtractIntervals(
  base: Interval[],
  blocked: Interval[],
): Interval[] {
  const merged = mergeIntervals(blocked);
  const free: Interval[] = [];

  for (const window of base) {
    let start = window.start;

    for (const block of merged) {
      if (block.end <= start) continue;
      if (block.start >= window.end) break;

      if (block.start > start) {
        free.push({ start, end: Math.min(block.start, window.end) });
      }
      start = Math.max(start, block.end);
      if (start >= window.end) break;
    }

    if (start < window.end) free.push({ start, end: window.end });
  }

  return free.filter((i) => i.end > i.start);
}

/**
 * Contiguous unbooked time inside the shifts — the model everything below is
 * built on.
 *
 * **The buffer is folded into the blocked intervals, not into the boundary
 * test.** A candidate `[c, c+d)` conflicts with a booking `b` exactly when it
 * overlaps `(b.start - buffer, b.end + buffer)`, so expanding each booking by
 * the buffer on both sides and then demanding `c + d <= window.end` is the
 * *same rule*, expressed once instead of at every comparison.
 *
 * That equivalence is why the boundary test below is `start + duration <= end`
 * rather than `start + duration + buffer <= end`. The trailing buffer is
 * already inside the window's edge wherever a booking created that edge — and
 * where the edge is the **end of the shift** there is nothing to be separated
 * from, so charging a buffer there would delete the last bookable slot of every
 * single day. Adding the buffer to the test would double-count it in the first
 * case and invent it in the second.
 *
 * Closures carry no buffer: a shop is shut or it is not.
 */
export function freeWindows({
  shifts,
  appointments,
  timeOff,
  bufferMs,
}: {
  shifts: Interval[];
  appointments: Interval[];
  timeOff: Interval[];
  bufferMs: number;
}): Interval[] {
  const blocked: Interval[] = [
    ...appointments.map((a) => ({
      start: a.start - bufferMs,
      end: a.end + bufferMs,
    })),
    ...timeOff,
  ];

  return subtractIntervals(mergeIntervals(shifts), blocked);
}

/**
 * How candidate start times are placed inside a free window.
 *
 * - **`dense`** packs from the window's own start in whole service blocks, so a
 *   one-chair shop wastes nothing: a gap that opens at 09:35 is offered at
 *   09:35, not at the next tidy number.
 * - **`grid`** offers only anchors on a shared lattice. It gives up a little
 *   density to buy something a team shop needs more: every provider's times
 *   line up, so the union across staff is one clean column of times instead of
 *   two interleaved ones.
 */
export type SlotPacking =
  { mode: "dense" } | { mode: "grid"; baseGridMin: number; originMs: number };

/** Greatest common divisor, for the base-grid fallback. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The lattice a team shop's slots snap to.
 *
 * **The tenant's own `slot_interval_min` wins**, and reviving it here is
 * deliberate: it had decayed into a live-looking setting that changed nothing,
 * which ARCHITECTURE.md flagged as the worse of the two options available.
 *
 * The GCD of the service blocks is only the fallback, because on a real
 * catalogue it is far too fine to be useful. `gcd(15, 20, 30, 45)` is **5**,
 * which would offer 09:00, 09:05, 09:10 … — the exact five-minute noise a
 * one-chair shop reported seeing, reintroduced deliberately this time. So it is
 * floored at 5 and only reached when a tenant has no interval configured at
 * all.
 */
export function baseGridMinutes(
  slotIntervalMin: number,
  serviceBlockMins: number[] = [],
): number {
  if (slotIntervalMin > 0) return slotIntervalMin;

  const blocks = serviceBlockMins.filter((m) => m > 0);
  if (blocks.length === 0) return 15;

  return Math.max(5, blocks.reduce(gcd));
}

/**
 * Pure slot generation. No IO, so every rule below is unit-testable:
 *
 * - the grid steps by the service's **total block** — `durationMin +
 *   bufferMin` — from each shift start, so consecutive starts leave no
 *   unbookable remainder between them;
 * - a booking re-anchors the grid: the next start is that booking's end plus
 *   the buffer, and stepping resumes from there rather than from the shift
 *   start;
 * - an appointment blocks a candidate unless at least `bufferMin` separates
 *   them (enforced on both sides, so the gap holds whichever is booked first);
 * - time off blocks on plain overlap, with no buffer;
 * - `minNoticeMin` and `maxAdvanceDays` are measured from `now`.
 *
 * `slotIntervalMin` is now only a fallback for a service with no usable
 * duration, which the guard above already rejects — see the note on the step.
 */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const {
    business,
    durationMin,
    serviceBufferMin,
    shifts,
    appointments,
    timeOff,
    date,
    now,
    packing = { mode: "dense" },
  } = input;
  const { timezone, slotIntervalMin } = business;

  // A service may override the shop-wide gap; 0 is a real value, so only
  // null/undefined falls back.
  const bufferMin = serviceBufferMin ?? business.bufferMin;

  // A service with no length is unbookable whatever the grid says.
  if (durationMin <= 0) return [];

  /**
   * The grid steps by the service's whole block, not by a shop-wide interval:
   * a 15-minute service with a 5-minute gap occupies 20 minutes, so the next
   * start is 20 minutes later and the day packs with no unbookable remainder.
   *
   * `slotIntervalMin` survives only as a fallback for a block that somehow
   * computes to zero — unreachable while `durationMin > 0` and `bufferMin`
   * cannot be negative, but cheap insurance against a bad column.
   */
  const blockMin = durationMin + bufferMin;
  const stepMin =
    blockMin > 0 ? blockMin : slotIntervalMin > 0 ? slotIntervalMin : 15;

  const durationMs = durationMin * MINUTE_MS;
  const stepMs = stepMin * MINUTE_MS;
  const bufferMs = bufferMin * MINUTE_MS;

  const earliest = now.getTime() + business.minNoticeMin * MINUTE_MS;
  const latest = now.getTime() + business.maxAdvanceDays * DAY_MS;

  // Wall-clock times are stored naive and interpreted in the business
  // timezone; fromZonedTime resolves them to real UTC instants, DST included.
  const shiftIntervals: Interval[] = [];
  for (const shift of shifts) {
    if (shift.isClosed) continue;
    const start = fromZonedTime(
      `${date}T${shift.startTime}`,
      timezone,
    ).getTime();
    const end = fromZonedTime(`${date}T${shift.endTime}`, timezone).getTime();
    // Overnight or zero-length shifts are not supported; drop rather than loop.
    if (end > start) shiftIntervals.push({ start, end });
  }
  if (shiftIntervals.length === 0) return [];

  /**
   * Free windows first, candidates second.
   *
   * This replaced a cursor that walked the day and jumped forward whenever it
   * hit something. That worked, but it fused two questions — *where is there
   * free time* and *where may a slot start* — into one loop, so the answer to
   * the second was only ever observable through the first. Splitting them is
   * what makes a scattered day testable: the windows between a 10:00 and a
   * 12:00 booking are now a value you can assert on, and the packing rule is a
   * separate decision applied to it.
   */
  const windows = freeWindows({
    shifts: shiftIntervals,
    appointments: appointments.map((a) => ({
      start: a.startsAt.getTime(),
      end: a.endsAt.getTime(),
    })),
    timeOff: timeOff.map((t) => ({
      start: t.startsAt.getTime(),
      end: t.endsAt.getTime(),
    })),
    bufferMs,
  });

  // A set, because two shifts or two windows can legitimately propose the same
  // instant and a client must never see the same time twice.
  const starts = new Set<number>();

  for (const window of windows) {
    if (packing.mode === "dense") {
      /**
       * From the window's own start, in whole blocks. The first candidate is
       * the earliest instant that is genuinely free — 09:35 after a booking
       * that ended at 09:35, not the next round number — and each one after it
       * is a full `duration + buffer` later, so consecutive bookings inside the
       * window leave no remainder too short to sell.
       */
      for (let t = window.start; t + durationMs <= window.end; t += stepMs) {
        starts.add(t);
      }
      continue;
    }

    /**
     * Grid mode offers *every* anchor that fits, stepping by the lattice rather
     * than by the block. These are alternative start times, not consecutive
     * bookings: a 60-minute service on a 15-minute grid is offered at 09:00,
     * 09:15, 09:30 … and booking one removes the rest from the next request.
     *
     * The origin is the day's local midnight rather than the shift start, and
     * that is the whole point of the mode: two providers whose shifts begin at
     * 09:00 and 09:35 still land on the *same* anchors, so the union across a
     * team is one column of times instead of two interleaved ones.
     */
    const gridMs = packing.baseGridMin * MINUTE_MS;
    const firstAnchor =
      packing.originMs +
      Math.ceil((window.start - packing.originMs) / gridMs) * gridMs;

    for (let t = firstAnchor; t + durationMs <= window.end; t += gridMs) {
      starts.add(t);
    }
  }

  return [...starts]
    .filter((start) => start >= earliest && start <= latest)
    .sort((a, b) => a - b)
    .map((start) => ({
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + durationMs).toISOString(),
      label: formatInTimeZone(new Date(start), timezone, "HH:mm"),
    }));
}

/* -------------------------------------------------------------------------- */
/* Multi-staff                                                                */
/* -------------------------------------------------------------------------- */

export type StaffAvailability = {
  id: string;
  /**
   * This person's shifts for the requested weekday. **Empty means "inherit the
   * business hours"**, which is what lets a single-staff shop — and any staff
   * member who simply works the shop's hours — never touch a schedule.
   *
   * Non-empty means "these hours **∩ the shop's**". A personal schedule narrows
   * when someone works; it never opens the shop early. See `intersectShifts`.
   */
  shifts: AvailabilityShift[];
  /** Only *this* person's appointments. */
  appointments: BusyInterval[];
  /**
   * Only *this* person's absences — `time_off` rows naming them. Shop-wide
   * closures arrive separately and are added to this list, never instead of it.
   */
  timeOff: BusyInterval[];
};

/** A slot, plus who could actually take it. */
export type SlotWithStaff = Slot & { staffIds: string[] };

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Wall-clock "HH:mm" or "HH:mm:ss" to seconds since midnight, or null.
 *
 * Parsed rather than compared as strings, because the two sources genuinely
 * disagree on format: a `time` column comes back as `"09:00:00"` and a shift
 * built in a test or a form is `"09:00"`. Lexicographically `"09:00" < "09:00:00"`,
 * so string comparison would clip a shift by its own formatting.
 */
function toSeconds(time: string): number | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function toTime(seconds: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/**
 * Staff hours **clipped to** business hours, rather than instead of them.
 *
 * ---------------------------------------------------------------------------
 * This function is a bug fix with a name.
 *
 * Personal schedules used to *replace* the shop's hours whenever a staff member
 * had any rows at all. So a barber whose row said 08:00–20:00 was offered from
 * 08:00 to 20:00 even though the shop opens at 09:00 and closes at 17:00 — and
 * because only that one person had a row, the booking flow showed those times
 * with exactly one provider free, which is how it was spotted. A staff row on a
 * weekday the shop is closed did the same thing, on a day with no hours at all.
 *
 * A personal schedule is a **restriction on** when someone works, never a
 * licence to work when the shop is shut. So: no rows still means "inherit the
 * shop's hours", and rows mean "these hours, ∩ the shop's".
 *
 * The empty result is meaningful and must not fall back — a staff member whose
 * hours lie entirely outside the shop's works no hours that day. The caller
 * makes the inherit-or-intersect decision on the *raw* row count, before this
 * runs, precisely so an empty intersection cannot be mistaken for "no rows".
 * ---------------------------------------------------------------------------
 */
export function intersectShifts(
  staffShifts: AvailabilityShift[],
  businessShifts: AvailabilityShift[],
): AvailabilityShift[] {
  const open = businessShifts
    .filter((shift) => !shift.isClosed)
    .map((shift) => ({
      from: toSeconds(shift.startTime),
      to: toSeconds(shift.endTime),
    }))
    .filter(
      (window): window is { from: number; to: number } =>
        window.from !== null && window.to !== null && window.to > window.from,
    );

  if (open.length === 0) return [];

  const clipped: AvailabilityShift[] = [];

  for (const shift of staffShifts) {
    if (shift.isClosed) continue;

    const from = toSeconds(shift.startTime);
    const to = toSeconds(shift.endTime);
    // An unparseable or inverted personal shift is dropped, not widened to the
    // shop's day: the safe reading of a broken row is that it grants nothing.
    if (from === null || to === null || to <= from) continue;

    for (const window of open) {
      const start = Math.max(from, window.from);
      const end = Math.min(to, window.to);
      // Touching at an endpoint is not an overlap — a shift ending at 12:00
      // against one starting at 12:00 shares no bookable minute.
      if (end > start) {
        clipped.push({
          startTime: toTime(start),
          endTime: toTime(end),
          isClosed: false,
        });
      }
    }
  }

  return clipped;
}

export type ComputeStaffSlotsInput = Omit<
  ComputeSlotsInput,
  "shifts" | "appointments" | "timeOff"
> & {
  /** Business-wide hours, used by any staff member with no schedule rows. */
  businessShifts: AvailabilityShift[];
  /**
   * Closures of the whole shop — a holiday, a renovation. Applied to everyone
   * *in addition to* each person's own absences.
   *
   * Named rather than inherited as plain `timeOff` because the distinction is
   * the entire point of `0016`: one of these hides a time from the client
   * completely, the other only removes one name from the picker.
   */
  businessTimeOff: BusyInterval[];
  staff: StaffAvailability[];
};

/**
 * Availability across a team.
 *
 * Deliberately a *layer over* `computeSlots` rather than a rewrite of it. Every
 * hard-won rule in that function — the block-sized step, the re-anchoring
 * cursor, the buffer on both sides, DST — applies per person unchanged, and
 * running it once per staff member is what makes the headline property true
 * without any new logic:
 *
 * > an appointment booked at 09:20 for one person leaves 09:20 open for another
 *
 * because each call only ever sees that person's own busy list. Trying to
 * express this inside `computeSlots` would have meant teaching the cursor walk
 * about resource sets, which is where the subtle bugs live.
 *
 * The returned list is the **union** across staff, which is what the booking
 * flow shows at step 2: a time is offered if at least one person is free. Each
 * slot carries the ids that were free at it, which is what step 3 picks from —
 * so the staff list a client sees is derived from the same computation that
 * offered them the time, and cannot disagree with it.
 *
 * Time off comes in two kinds and they compose rather than override: a shop
 * closure applies to everybody, a personal absence to one person. A holiday
 * removes the time from the page; one barber's afternoon off only removes their
 * name from the picker.
 */
export function computeStaffSlots(
  input: ComputeStaffSlotsInput,
): SlotWithStaff[] {
  const { businessShifts, businessTimeOff, staff, ...common } = input;

  const merged = new Map<string, SlotWithStaff>();

  for (const member of staff) {
    /**
     * No rows means "works the shop's hours". Rows mean "these hours, clipped
     * to the shop's" — never instead of them. The decision is made on the raw
     * row count so that an intersection which comes back **empty** stays empty:
     * someone whose hours fall entirely outside the shop's works no hours, and
     * falling back here would hand them the whole day.
     */
    const shifts =
      member.shifts.length > 0
        ? intersectShifts(member.shifts, businessShifts)
        : businessShifts;

    if (shifts.length === 0) continue;

    const slots = computeSlots({
      ...common,
      shifts,
      appointments: member.appointments,
      // Concatenated, not chosen between. A shop closed for a holiday closes
      // for someone who also happens to be on leave that week.
      timeOff: [...businessTimeOff, ...member.timeOff],
    });

    for (const slot of slots) {
      const existing = merged.get(slot.startsAt);
      if (existing) {
        existing.staffIds.push(member.id);
      } else {
        merged.set(slot.startsAt, { ...slot, staffIds: [member.id] });
      }
    }
  }

  return [...merged.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

/**
 * Who can take a given start time, from a computed list.
 *
 * Reads from the same array the client was shown rather than recomputing, so
 * the answer at step 3 cannot contradict the offer at step 2.
 */
export function staffAvailableAt(
  slots: SlotWithStaff[],
  startsAt: string,
): string[] {
  return slots.find((slot) => slot.startsAt === startsAt)?.staffIds ?? [];
}

/**
 * The lattice for a team shop, resolved with as few queries as possible.
 *
 * The tenant's `slot_interval_min` answers this on its own for every business
 * created by the app, since the column defaults to 15. The catalogue is fetched
 * **only** when it does not — a hand-edited or legacy row — so the hot path
 * keeps the query count it had before the grid existed.
 */
async function resolveBaseGrid(
  db: Database,
  business: { id: string; slotIntervalMin: number; bufferMin: number },
): Promise<number> {
  if (business.slotIntervalMin > 0) {
    return baseGridMinutes(business.slotIntervalMin);
  }

  const services = await listServices(db, business.id);
  return baseGridMinutes(
    business.slotIntervalMin,
    services.map((s) => s.durationMin + (s.bufferMin ?? business.bufferMin)),
  );
}

export type GetAvailableSlotsArgs = {
  businessId: string;
  serviceId: string;
  /** Calendar date in the business timezone, "YYYY-MM-DD". */
  date: string;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
};

/**
 * Server-side source of truth for availability. The client never computes
 * slots — it only echoes back a `startsAt` produced here, which the booking
 * action re-validates.
 *
 * Returns slots **with the staff who can take each one**, because the booking
 * flow needs both from one computation: offering a time and then listing who is
 * free at it must never be two answers that can disagree.
 *
 * Takes the db handle explicitly so tests can pass a PGlite instance.
 */
export async function getAvailableSlotsWithStaff(
  db: Database,
  { businessId, serviceId, date, now = new Date() }: GetAvailableSlotsArgs,
): Promise<SlotWithStaff[]> {
  const [business, service] = await Promise.all([
    getBusinessById(db, businessId),
    getService(db, businessId, serviceId),
  ]);

  if (!business || !business.isActive) return [];
  if (!service || !service.isActive) return [];

  const weekday = weekdayOf(date);
  const businessShifts = await listWorkingHoursForWeekday(
    db,
    businessId,
    weekday,
  );

  const active = await listActiveStaff(db, businessId);
  // A tenant with every provider deactivated takes no bookings. Returning an
  // empty list is right — and is why the dashboard refuses to deactivate the
  // last one.
  if (active.length === 0) return [];

  /**
   * **`has_multiple_staff` decides who is bookable, not merely what renders.**
   *
   * It used to be documented as a pure UI switch, and this function read the
   * whole roster regardless. That is wrong in two ways for a shop that answered
   * "no" while still holding more than one active row — which is easy to reach,
   * because collapsing back to one chair deliberately does *not* delete people
   * who hold history:
   *
   * 1. A secondary provider's hours and time off silently widened the shop's
   *    availability, offering times the one person actually working could not
   *    take. `createBookingAction` then assigned the booking to whoever was
   *    free first, so it could land on someone the owner had stopped counting.
   * 2. Each provider's grid re-anchors on their own bookings, and the union of
   *    two independently re-anchored grids interleaves. A colleague whose
   *    appointment ended at 09:05 put 09:05, 09:25 … alongside 09:00, 09:20 …
   *    — which is what a one-chair shop sees as "the slots jump by five
   *    minutes", with nothing on their own calendar to explain it.
   *
   * So the flag is applied *here*, above the engine, by choosing who goes into
   * it. `computeStaffSlots` itself still knows nothing about it — it is handed
   * a list and unions it — which keeps the rule in one place instead of
   * threading a tenant setting through the cursor walk.
   */
  const primary = primaryStaff(active);
  const team = business.hasMultipleStaff || !primary ? active : [primary];

  const staffIds = team.map((member) => member.id);

  // Widen the fetch window by a day on each side: a shift near midnight can
  // reach outside the local day once converted to UTC.
  const dayStart = fromZonedTime(`${date}T00:00:00`, business.timezone);
  const from = new Date(dayStart.getTime() - DAY_MS);
  const to = new Date(dayStart.getTime() + 2 * DAY_MS);

  const [appointments, timeOff, schedules] = await Promise.all([
    listAppointmentsInRange(db, businessId, from, to),
    listTimeOffInRange(db, businessId, from, to),
    listStaffSchedulesForWeekday(db, staffIds, weekday),
  ]);

  // One pass each, rather than a query per staff member: a team of ten would
  // otherwise be twenty round trips for one day of a booking page.
  const shiftsByStaff = new Map<string, AvailabilityShift[]>();
  for (const row of schedules) {
    const list = shiftsByStaff.get(row.staffId) ?? [];
    list.push({
      startTime: row.startTime,
      endTime: row.endTime,
      isClosed: false,
    });
    shiftsByStaff.set(row.staffId, list);
  }

  const busyByStaff = new Map<string, BusyInterval[]>();
  for (const appointment of appointments) {
    const list = busyByStaff.get(appointment.staffId) ?? [];
    list.push(appointment);
    busyByStaff.set(appointment.staffId, list);
  }

  // Split on `staffId`: a null is the whole shop, an id is one person. A row
  // naming a staff member who is no longer active simply lands in a bucket
  // nobody reads, which is the right outcome.
  const businessTimeOff: BusyInterval[] = [];
  const timeOffByStaff = new Map<string, BusyInterval[]>();
  for (const closure of timeOff) {
    if (!closure.staffId) {
      businessTimeOff.push(closure);
      continue;
    }
    const list = timeOffByStaff.get(closure.staffId) ?? [];
    list.push(closure);
    timeOffByStaff.set(closure.staffId, list);
  }

  /**
   * Single chair packs densely; a team snaps to a shared lattice.
   *
   * The same flag that decides *who* is bookable decides *how their times line
   * up*, and both for the same underlying reason. One provider's grid can
   * re-anchor freely because there is nothing to disagree with it. Two
   * providers' grids re-anchoring independently is what produced the
   * interleaved 09:00 / 09:05 / 10:00 / 10:05 column a shop reported — each
   * column correct on its own, the union unreadable.
   */
  const packing: SlotPacking = business.hasMultipleStaff
    ? {
        mode: "grid",
        baseGridMin: await resolveBaseGrid(db, business),
        // Local midnight, so the lattice is the same for every provider
        // regardless of when their own shift happens to start.
        originMs: dayStart.getTime(),
      }
    : { mode: "dense" };

  return computeStaffSlots({
    business,
    packing,
    durationMin: service.durationMin,
    serviceBufferMin: service.bufferMin,
    businessShifts,
    businessTimeOff,
    staff: team.map((member) => ({
      id: member.id,
      shifts: shiftsByStaff.get(member.id) ?? [],
      appointments: busyByStaff.get(member.id) ?? [],
      timeOff: timeOffByStaff.get(member.id) ?? [],
    })),
    date,
    now,
  });
}

/**
 * The times only, for callers that do not care who is free.
 *
 * Kept as its own export so the public slot endpoint and every existing test
 * read the same shape they always did; the staff-aware list is a superset.
 */
export async function getAvailableSlots(
  db: Database,
  args: GetAvailableSlotsArgs,
): Promise<Slot[]> {
  const slots = await getAvailableSlotsWithStaff(db, args);
  // Rebuilt field by field rather than by rest-destructuring, so adding a
  // property to `SlotWithStaff` cannot leak it into the narrower shape.
  return slots.map((slot) => ({
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    label: slot.label,
  }));
}
