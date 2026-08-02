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
 * - base slots step by `slotIntervalMin` from each shift start, and must end
 *   on or before that shift's end;
 * - **plus** the earliest legal start after each existing appointment, so a
 *   20-minute service does not lose the tail of every gap to the grid (see
 *   `backToBackStarts`);
 * - an appointment blocks a candidate unless at least `bufferMin` separates
 *   them (enforced on both sides, so the gap holds whichever is booked first);
 * - time off blocks on plain overlap, with no buffer;
 * - `minNoticeMin` and `maxAdvanceDays` are measured from `now`.
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

  if (durationMin <= 0 || slotIntervalMin <= 0) return [];

  const durationMs = durationMin * MINUTE_MS;
  const stepMs = slotIntervalMin * MINUTE_MS;
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

    // The grid alone loses the tail of every gap. A 20-minute service on a
    // 15-minute grid, with 09:15–09:35 booked, offers nothing until 09:45 —
    // 09:35 is legal but simply is not a grid point. Adding the earliest legal
    // start after each appointment recovers exactly those windows.
    //
    // Strictly additive: every candidate still runs the same overlap, notice,
    // horizon and closure checks below, so this can only ever offer more
    // times, never fewer, and never one that conflicts.
    const backToBackStarts = busy
      .map((b) => b.end + bufferMs)
      .filter((start) => start >= shiftStart && start + durationMs <= shiftEnd);

    const candidates: number[] = [];
    for (
      let start = shiftStart;
      start + durationMs <= shiftEnd;
      start += stepMs
    ) {
      candidates.push(start);
    }
    candidates.push(...backToBackStarts);
    candidates.sort((a, b) => a - b);

    for (const start of candidates) {
      const end = start + durationMs;

      // Also dedupes a back-to-back start that the grid already produced.
      if (seen.has(start)) continue;
      if (start < earliest || start > latest) continue;

      const hitsAppointment = busy.some((b) =>
        overlaps(start - bufferMs, end + bufferMs, b.start, b.end),
      );
      if (hitsAppointment) continue;

      const hitsClosure = closures.some((c) =>
        overlaps(start, end, c.start, c.end),
      );
      if (hitsClosure) continue;

      seen.add(start);
      slots.push({
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        label: formatInTimeZone(new Date(start), timezone, "HH:mm"),
      });
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
