import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import type {
  CalendarDay,
  CalendarEntry,
} from "@/components/dashboard/week-calendar";
import {
  listAppointmentsInRange,
  listTimeOffInRange,
  listWorkingHours,
  mapClientNotes,
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import type { Business } from "@/db/schema";
import type { Database } from "@/db/types";
import { appointmentOrigin } from "@/lib/appointment-origin";
import { withoutCoveredCancellations } from "@/lib/calendar-layout";
import {
  dayLabel,
  shiftDays,
  toDaySpans,
  weekOf,
} from "@/lib/calendar-week";

/**
 * One week of the full calendar, ready to draw.
 *
 * ---------------------------------------------------------------------------
 * **Shared by the page and by `/api/dashboard/week`, so the two cannot draw
 * different weeks.** The page renders the week in the address bar; the
 * endpoint serves every other week the owner steps to without a navigation —
 * see `WeekCalendar`. Both go through this function, which does all the
 * timezone work and hands the client pure geometry — day indices and minutes
 * from local midnight — because the browser's zone is not the shop's.
 * ---------------------------------------------------------------------------
 */
export type CalendarWeekData = {
  weekStart: string;
  days: CalendarDay[];
  entries: CalendarEntry[];
};

export async function loadCalendarWeek(
  db: Database,
  business: Pick<Business, "id" | "timezone">,
  anchor: string,
  today: string,
): Promise<CalendarWeekData> {
  const days = weekOf(anchor);

  // One query for the week on screen, converted from local days to UTC.
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, business.timezone);
  const rangeEnd = fromZonedTime(
    `${shiftDays(days[6], 1)}T00:00:00`,
    business.timezone,
  );

  const [appointments, blocks, team, hours, clientNotes] = await Promise.all([
    /**
     * Cancelled rows too. A cancellation is drawn as dimmed glass while its
     * slot is still open — it is the reason for the gap — and dropped once
     * something else holds that time: see `withoutCoveredCancellations`.
     */
    listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
      "pending",
      "confirmed",
      "completed",
      "no_show",
      "cancelled",
    ]),
    listTimeOffInRange(db, business.id, rangeStart, rangeEnd),
    listActiveStaff(db, business.id),
    listWorkingHours(db, business.id),
    /**
     * **Only the clients on screen.** This used to read every annotated client
     * the shop has ever had, on every week — a table that only grows, fetched
     * whole to label a few dozen cards.
     */
    mapClientNotes(db, business.id, { from: rangeStart, to: rangeEnd }),
  ]);

  const staffById = new Map(team.map((member) => [member.id, member]));
  const entries: CalendarEntry[] = [];

  for (const appointment of appointments) {
    const member = staffById.get(appointment.staffId);

    /**
     * The booking's own wall clock, resolved once here rather than per span.
     *
     * A span is a *drawing* — clipped at midnight, one per day a booking
     * touches — so its minutes describe the card, not the appointment. The edit
     * dialog has to seed its date and time fields from the appointment itself.
     */
    const localDate = formatInTimeZone(
      appointment.startsAt,
      business.timezone,
      "yyyy-MM-dd",
    );

    for (const span of toDaySpans(
      appointment.startsAt,
      appointment.endsAt,
      business.timezone,
      days,
    )) {
      entries.push({
        // Unique per span, so a booking that crosses midnight gets one card a
        // day rather than two React children with the same key.
        id: `${appointment.id}:${span.dayIndex}`,
        // The row's real id, which is what an action has to be given.
        appointmentId: appointment.id,
        kind: "appointment",
        title: appointment.clientName,
        subtitle: appointment.serviceName,
        clientPhone: appointment.clientPhone,
        notes: appointment.notes,
        clientProfileNotes: clientNotes.get(appointment.clientPhone) ?? null,
        // Coerced here, so a card never has to render an unknown value.
        origin: appointmentOrigin(appointment.createdVia),
        status: appointment.status,
        priceCents: appointment.priceCents,
        staffId: appointment.staffId,
        staffName: team.length > 1 ? (member?.name ?? null) : null,
        staffColor: member?.color ?? null,
        timeOffId: null,
        date: localDate,
        startTime: formatInTimeZone(
          appointment.startsAt,
          business.timezone,
          "HH:mm",
        ),
        endTime: formatInTimeZone(
          appointment.endsAt,
          business.timezone,
          "HH:mm",
        ),
        ...span,
      });
    }
  }

  for (const block of blocks) {
    const member = block.staffId ? staffById.get(block.staffId) : null;

    for (const span of toDaySpans(
      block.startsAt,
      block.endsAt,
      business.timezone,
      days,
    )) {
      entries.push({
        id: `${block.id}:${span.dayIndex}`,
        // A block is a `time_off` row, not an appointment — the dialog and every
        // appointment action are unreachable for it by construction.
        appointmentId: null,
        kind: "block",
        title: block.reason ?? "חסום",
        subtitle: [
          member ? member.name : "כל העסק",
          `${formatInTimeZone(block.startsAt, business.timezone, "d.M HH:mm")}–${formatInTimeZone(block.endsAt, business.timezone, "HH:mm")}`,
        ].join(" · "),
        clientPhone: null,
        notes: null,
        clientProfileNotes: null,
        // A block is not a booking and has no origin to speak of.
        origin: "online" as const,
        status: null,
        priceCents: null,
        staffId: block.staffId,
        staffName: member?.name ?? null,
        staffColor: null,
        timeOffId: block.id,
        date: formatInTimeZone(block.startsAt, business.timezone, "yyyy-MM-dd"),
        startTime: formatInTimeZone(block.startsAt, business.timezone, "HH:mm"),
        endTime: formatInTimeZone(block.endsAt, business.timezone, "HH:mm"),
        ...span,
      });
    }
  }

  // Open hours per weekday, so closed time reads as closed rather than empty.
  const openByWeekday = new Map<
    number,
    { startMinutes: number; endMinutes: number }[]
  >();
  for (const row of hours) {
    if (row.isClosed) continue;
    const list = openByWeekday.get(row.weekday) ?? [];
    list.push({
      startMinutes: toMinutes(row.startTime),
      endMinutes: toMinutes(row.endTime),
    });
    openByWeekday.set(row.weekday, list);
  }

  return {
    weekStart: days[0],
    days: days.map((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        label: dayLabel(date),
        weekday,
        isToday: date === today,
        open: openByWeekday.get(weekday) ?? [],
      };
    }),
    entries: withoutCoveredCancellations(entries),
  };
}

/** "09:00:00" → 540. The column is a `time`, so it is always wall clock. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}
