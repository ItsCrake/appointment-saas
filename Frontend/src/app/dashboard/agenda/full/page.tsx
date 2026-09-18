import type { Metadata } from "next";

import { WeekCalendar } from "@/components/dashboard/week-calendar";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { listActiveStaff } from "@/db/queries/staff";
import { toThemeColor } from "@/lib/branding";
import { loadCalendarWeek } from "@/lib/calendar-week-data";
import { requireBusiness } from "@/lib/dashboard-session";
import { todayInTimezone } from "@/lib/format";

export const metadata: Metadata = { title: "יומן מלא" };

/** The week is always as of now; a cached page would show a stale one. */
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PageProps = {
  searchParams: Promise<{ week?: string; view?: string; focus?: string }>;
};

/**
 * The full week calendar.
 *
 * ---------------------------------------------------------------------------
 * The server renders **the week in the address bar**, through
 * `loadCalendarWeek` — the same function `/api/dashboard/week` serves every
 * other week from, so the week a refresh draws and the week an arrow steps to
 * cannot disagree. From there the calendar moves in its own state: see
 * `WeekCalendar` and `range-cache`.
 *
 * `requireBusiness`, not `requireWritable` — a frozen tenant may look at their
 * own week. The actions behind the dialogs are what refuse the writes.
 * ---------------------------------------------------------------------------
 */
export default async function FullCalendarPage({ searchParams }: PageProps) {
  const { business } = await requireBusiness();
  const { week, view: rawView, focus } = await searchParams;

  const today = todayInTimezone(business.timezone);
  const anchor = week && DATE_PATTERN.test(week) ? week : today;

  /**
   * Day and week are the *same grid* over a different number of columns, and
   * the server always sends **the whole week** regardless of which is showing,
   * so toggling between them and stepping between days of the week needs no
   * network at all. `view` and the focused day are therefore *initial* state
   * for the client rather than a rendering instruction.
   */
  const view = rawView === "day" ? "day" : "week";

  const [data, team] = await Promise.all([
    loadCalendarWeek(db, business, anchor, today),
    listActiveStaff(db, business.id),
  ]);

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
        /**
         * From ליבי: "תראי לי את התור של דנה ביום רביעי" lands here with the
         * booking's own week and id, so the owner arrives looking at the
         * appointment rather than at a week containing it. Shape-checked
         * rather than trusted — it goes into an element id and a comparison,
         * and an id that matches nothing simply rings nothing.
         */
        focusAppointmentId={
          focus && /^[0-9a-f-]{36}$/i.test(focus) ? focus : undefined
        }
        days={data.days}
        entries={data.entries}
        weekStart={data.weekStart}
        thisWeek={today}
        staff={team.map((member) => ({
          id: member.id,
          name: member.name,
          color: member.color,
        }))}
        timezone={business.timezone}
        scope={business.id}
      />
    </div>
  );
}
