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
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
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
   * Day and week are the *same grid* over a different number of columns.
   *
   * A separate day component would be a second implementation of lane
   * assignment, percentage placement and the block dialog — and the two would
   * drift the first time either was fixed. One column is simply seven minus
   * six, and every card gets seven times the width for free, which is the whole
   * reason the day view is worth having.
   */
  const view = rawView === "day" ? "day" : "week";
  const days = view === "day" ? [anchor] : weekOf(anchor);

  // One query for the range on screen, converted from local days to UTC.
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, business.timezone);
  const rangeEnd = new Date(rangeStart.getTime() + days.length * 86_400_000);

  const [appointments, blocks, team, hours] = await Promise.all([
    listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
      "pending",
      "confirmed",
      "completed",
      "no_show",
    ]),
    listTimeOffInRange(db, business.id, rangeStart, rangeEnd),
    listActiveStaff(db, business.id),
    listWorkingHours(db, business.id),
  ]);

  const staffById = new Map(team.map((member) => [member.id, member]));

  const entries: CalendarEntry[] = [];

  for (const appointment of appointments) {
    const member = staffById.get(appointment.staffId);
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
        kind: "appointment",
        title: appointment.clientName,
        subtitle: appointment.serviceName,
        clientPhone: appointment.clientPhone,
        status: appointment.status,
        priceCents: appointment.priceCents,
        staffName: team.length > 1 ? (member?.name ?? null) : null,
        staffColor: member?.color ?? null,
        timeOffId: null,
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
        kind: "block",
        title: block.reason ?? "חסום",
        subtitle: [
          member ? member.name : "כל העסק",
          `${formatInTimeZone(block.startsAt, business.timezone, "d.M HH:mm")}–${formatInTimeZone(block.endsAt, business.timezone, "HH:mm")}`,
        ].join(" · "),
        clientPhone: null,
        status: null,
        priceCents: null,
        staffName: member?.name ?? null,
        staffColor: null,
        timeOffId: block.id,
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
    <div className="pb-4">
      <PageHeader
        title="יומן מלא"
        subtitle="כל התורים, החסימות והצוות במקום אחד"
      />

      <WeekCalendar
        view={view}
        days={calendarDays}
        entries={entries}
        weekStart={days[0]}
        previousWeek={shiftDays(days[0], view === "day" ? -1 : -7)}
        nextWeek={shiftDays(days[0], view === "day" ? 1 : 7)}
        thisWeek={today}
        staff={team.map((member) => ({
          id: member.id,
          name: member.name,
          color: member.color,
        }))}
        timezone={business.timezone}
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
