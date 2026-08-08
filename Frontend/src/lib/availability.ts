import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import {
  getBusinessById,
  getService,
  listAppointmentsInRange,
  listTimeOffInRange,
  listWorkingHoursForWeekday,
} from "@/db/queries";
import {
  listActiveStaff,
  listStaffSchedulesForWeekday,
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
};

/** Day of week (0 = Sunday) for a plain "YYYY-MM-DD" calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Half-open overlap: [aStart, aEnd) vs [bStart, bEnd). Back-to-back intervals
 * do not overlap, which is what makes 09:30 bookable right after 09:00–09:30.
 */
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
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

  const busy = appointments.map((a) => ({
    start: a.startsAt.getTime(),
    end: a.endsAt.getTime(),
  }));
  const closures = timeOff.map((t) => ({
    start: t.startsAt.getTime(),
    end: t.endsAt.getTime(),
  }));

  const seen = new Set<number>();
  const slots: Slot[] = [];

  for (const shift of shifts) {
    if (shift.isClosed) continue;

    // Wall-clock times are stored naive and interpreted in the business
    // timezone; fromZonedTime resolves them to real UTC instants, DST included.
    const shiftStart = fromZonedTime(
      `${date}T${shift.startTime}`,
      timezone,
    ).getTime();
    const shiftEnd = fromZonedTime(
      `${date}T${shift.endTime}`,
      timezone,
    ).getTime();

    // Overnight or zero-length shifts are not supported; skip rather than loop.
    if (!(shiftEnd > shiftStart)) continue;

    /**
     * A cursor walk rather than a precomputed candidate list, because a
     * booking does not merely block a start — it *moves* the grid. After an
     * appointment the next start is its end plus the buffer, and stepping
     * resumes from there.
     *
     * Keeping the original grid line as well would offer 09:40 immediately
     * after a re-anchored 09:35 and strand a 5-minute sliver nobody can book,
     * which is the fragmentation this whole scheme exists to avoid.
     *
     * Terminates: every branch moves `cursor` strictly forward. A conflict can
     * only match when `cursor < conflict.end + bufferMs`, and a closure only
     * when `cursor < closure.end`, so both jumps are increases; otherwise the
     * cursor advances by a positive step.
     */
    let cursor = shiftStart;

    while (cursor + durationMs <= shiftEnd) {
      const end = cursor + durationMs;

      const conflict = busy.find((b) =>
        overlaps(cursor - bufferMs, end + bufferMs, b.start, b.end),
      );
      if (conflict) {
        cursor = conflict.end + bufferMs;
        continue;
      }

      // Closures re-anchor too, for the same reason; no buffer applies to them.
      const closure = closures.find((c) =>
        overlaps(cursor, end, c.start, c.end),
      );
      if (closure) {
        cursor = closure.end;
        continue;
      }

      // Outside the notice window or past the horizon: skip this start but
      // keep walking, since the rest of the shift may still be bookable.
      if (cursor < earliest || cursor > latest || seen.has(cursor)) {
        cursor += stepMs;
        continue;
      }

      const start = cursor;
      seen.add(start);
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        label: formatInTimeZone(new Date(start), timezone, "HH:mm"),
      });

      cursor += stepMs;
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
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
    const shifts = member.shifts.length > 0 ? member.shifts : businessShifts;
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

  const team = await listActiveStaff(db, businessId);
  // A tenant with every provider deactivated takes no bookings. Returning an
  // empty list is right — and is why the dashboard refuses to deactivate the
  // last one.
  if (team.length === 0) return [];

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

  return computeStaffSlots({
    business,
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
