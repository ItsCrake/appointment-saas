import type { Metadata } from "next";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import {
  BlockList,
  WeekCalendar,
  type CalendarDay,
  type CalendarEntry,
} from "@/components/dashboard/week-calendar";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import {
  listAppointmentsInRange,
  listTimeOffInRange,
  listWorkingHours,
  mapClientNotes,
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import { toThemeColor } from "@/lib/branding";
import { shiftDays, toDaySpans, weekOf } from "@/lib/calendar-week";
import { requireBusiness } from "@/lib/dashboard-session";
import { todayInTimezone } from "@/lib/format";

export const metadata: Metadata = { title: "יומן מלא" };

/** The week is always as of now; a cached page would show a stale one. */
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageProps = {
  searchParams: Promise<{ week?: string; view?: string }>;
};

/**
 * The full week calendar.
 *
 * ---------------------------------------------------------------------------
 * This page does all the timezone work and hands the client component pure
 * geometry — day indices and minutes from local midnight. Same division as the
 * agenda (pre-formatted strings) and analytics (`AT TIME ZONE` in SQL), for the
 * same reason: the browser's zone is not the shop's.
 *
 * `requireBusiness`, not `requireWritable` — a frozen tenant may look at their
 * own week. The actions behind the block dialog are what refuse the writes.
 * ---------------------------------------------------------------------------
 */
export default async function FullCalendarPage({ searchParams }: PageProps) {
  const { business } = await requireBusiness();
  const { week, view: rawView } = await searchParams;

  const today = todayInTimezone(business.timezone);
  const anchor = week && DATE_PATTERN.test(week) ? week : today;

  /**
   * Day and week are the *same grid* over a different number of columns, and
   * the server always sends **the whole week** regardless of which is showing.
   *
   * That last part is the performance fix. Fetching only the focused day made
   * every toggle a server round trip for data the browser had just been given:
   * a week view already holds the day, so switching to it needed no network at
   * all. Sending seven days always costs one query either way — the range is a
   * single indexed scan — and buys an instant toggle and instant movement
   * between days inside the week.
   *
   * `view` and the focused day are therefore *initial* state for the client
   * rather than a rendering instruction.
   */
  const view = rawView === "day" ? "day" : "week";
  const days = weekOf(anchor);

  // One query for the week on screen, converted from local days to UTC.
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, business.timezone);
  const rangeEnd = new Date(rangeStart.getTime() + 7 * 86_400_000);

  const [appointments, blocks, team, hours, clientNotes] = await Promise.all([
    listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
      "pending",
      "confirmed",
      "completed",
      "no_show",
    ]),
    listTimeOffInRange(db, business.id, rangeStart, rangeEnd),
    listActiveStaff(db, business.id),
    listWorkingHours(db, business.id),
    // One query for the tenant's whole annotated client list, rather than a
    // lookup per card. See `mapClientNotes`.
    mapClientNotes(db, business.id),
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
     * dialog has to seed its date and time fields from the appointment itself,
     * and this page is where the timezone lives.
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
        // The row's real id, which is what an action has to be given. Every
        // span of one booking carries the same one.
        appointmentId: appointment.id,
        kind: "appointment",
        title: appointment.clientName,
        subtitle: appointment.serviceName,
        clientPhone: appointment.clientPhone,
        notes: appointment.notes,
        clientProfileNotes: clientNotes.get(appointment.clientPhone) ?? null,
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
    const spans = toDaySpans(
      block.startsAt,
      block.endsAt,
      business.timezone,
      days,
    );

    for (const span of spans) {
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

  const calendarDays: CalendarDay[] = days.map((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      label: formatInTimeZone(
        new Date(`${date}T12:00:00Z`),
        business.timezone,
        "d.M",
      ),
      weekday,
      isToday: date === today,
      open: openByWeekday.get(weekday) ?? [],
    };
  });

  return (
    /**
     * `data-accent` is what makes the glass on this calendar the tenant's own
     * colour rather than the indigo root fallback.
     *
     * The dashboard chrome is deliberately monochrome — see `ui.tsx` — and this
     * is the one screen inside it that carries the shop's hue, because the
     * bookings on it are the same objects the client sees on the branded booking
     * page. Nothing else here reads `(--accent)`, so nothing else changes; it is
     * also what fixes today's column, which was resolving the fallback and
     * keeping its *light* soft tint in dark mode, since the dark overrides are
     * scoped to this attribute.
     */
    <div data-accent={toThemeColor(business.themeColor)} className="pb-4">
      <PageHeader
        title="יומן מלא"
        subtitle="כל התורים, החסימות והצוות במקום אחד"
      />

      <WeekCalendar
        initialView={view}
        initialDate={anchor}
        days={calendarDays}
        entries={entries}
        weekStart={days[0]}
        previousWeek={shiftDays(days[0], -7)}
        nextWeek={shiftDays(days[0], 7)}
        thisWeek={today}
        staff={team.map((member) => ({
          id: member.id,
          name: member.name,
          color: member.color,
        }))}
        timezone={business.timezone}
        requiresApproval={business.requiresApproval}
      />

      <BlockList blocks={entries.filter((entry) => entry.kind === "block")} />
    </div>
  );
}

/** "09:00:00" → 540. The column is a `time`, so it is always wall clock. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}
