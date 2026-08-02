import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import {
  getBusinessById,
  getService,
  listAppointmentsInRange,
  listTimeOffInRange,
  listWorkingHoursForWeekday,
} from "@/db/queries";
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
 * Takes the db handle explicitly so tests can pass a PGlite instance.
 */
export async function getAvailableSlots(
  db: Database,
  { businessId, serviceId, date, now = new Date() }: GetAvailableSlotsArgs,
): Promise<Slot[]> {
  const [business, service] = await Promise.all([
    getBusinessById(db, businessId),
    getService(db, businessId, serviceId),
  ]);

  if (!business || !business.isActive) return [];
  if (!service || !service.isActive) return [];

  const shifts = await listWorkingHoursForWeekday(
    db,
    businessId,
    weekdayOf(date),
  );
  if (shifts.length === 0) return [];

  // Widen the fetch window by a day on each side: a shift near midnight can
  // reach outside the local day once converted to UTC.
  const dayStart = fromZonedTime(`${date}T00:00:00`, business.timezone);
  const from = new Date(dayStart.getTime() - DAY_MS);
  const to = new Date(dayStart.getTime() + 2 * DAY_MS);

  const [appointments, timeOff] = await Promise.all([
    listAppointmentsInRange(db, businessId, from, to),
    listTimeOffInRange(db, businessId, from, to),
  ]);

  return computeSlots({
    business,
    durationMin: service.durationMin,
    serviceBufferMin: service.bufferMin,
    shifts,
    appointments,
    timeOff,
    date,
    now,
  });
}
