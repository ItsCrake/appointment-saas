import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { CalendarRange, ExternalLink } from "lucide-react";

import { AgendaView } from "@/components/dashboard/agenda-view";
import { AppointmentStatusProvider } from "@/components/dashboard/appointment-status-store";
import { PendingRequests } from "@/components/dashboard/pending-requests";
import { TodaySummary } from "@/components/dashboard/today-summary";
import { db } from "@/db";
import {
  getDashboardStats,
  getNextUpcomingAppointment,
  listAppointmentsInRange,
  listPendingRequests,
  listServices,
} from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import { requireBusiness } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import { todayInTimezone } from "@/lib/format";
import { getStatsWindows, toPercent } from "@/lib/stats";
import { isLibiConfigured } from "@/lib/voice/libi";

export const metadata: Metadata = { title: "היומן" };

/** Trailing window the cancellation and no-show rates are measured over. */
const RATES_WINDOW_DAYS = 30;

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * **One day, and only one.**
 *
 * The `view` parameter and the week it selected are gone. The week this page
 * used to draw was a list of seven headings — no grid, no blocks, no staff — and
 * `/dashboard/agenda/full` answers the same question properly, one tap away
 * through the header. An old `?view=week` link now simply lands on that day,
 * which is the right thing for a bookmark to do.
 */
export default async function AgendaPage({ searchParams }: PageProps) {
  const { business } = await requireBusiness();
  const { date } = await searchParams;

  const today = todayInTimezone(business.timezone);
  const day = date && DATE_PATTERN.test(date) ? date : today;

  // One query for the day on screen, converted from a local day to UTC.
  const rangeStart = fromZonedTime(`${day}T00:00:00`, business.timezone);
  const rangeEnd = new Date(rangeStart.getTime() + 86_400_000);

  const windows = getStatsWindows(business.timezone);

  const [appointments, services, stats, nextUpcoming, requests, team] =
    await Promise.all([
      listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
        "pending",
        "confirmed",
        "completed",
        "no_show",
      ]),
      listServices(db, business.id),
      getDashboardStats(db, business.id, windows),
      getNextUpcomingAppointment(db, business.id, windows.now),
      // Every open request, not only today's — see `PendingRequests`.
      listPendingRequests(db, business.id, windows.now),
      // Who a manual booking may be assigned to. Active only: an inactive
      // provider is off the rota, and offering them here would create a
      // booking the availability engine does not believe in.
      listActiveStaff(db, business.id),
    ]);

  return (
    <div>
      {/* Three flex children under `justify-between` used to wrap into each
          other on a phone, and the subtitle restated a shop name its only
          reader already owns — the impersonation banner is what names a
          business when that is genuinely in doubt. Title on one side, both
          destinations grouped on the other, one row at every width. */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          היומן
        </h1>

        <div className="flex shrink-0 items-center gap-2">
          {/* Rare enough to be quiet: an owner opens their own public page to
              check or share it, not to work. Icon-only below `sm`, where the
              label was what forced the header onto a second line.

              `?preview=1` asks for the owner bar, exactly as the share link in
              settings does. Without it an owner arriving from here lands on
              their own booking page with no way back — the bar is the *only*
              route to the dashboard from a public page, which has no dashboard
              chrome of its own. The flag grants nothing: `/[slug]` resolves the
              session and checks ownership before rendering the bar. */}
          <Link
            href={`/${business.slug}?preview=1`}
            target="_blank"
            aria-label="עמוד ההזמנות"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white p-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 sm:px-3 sm:py-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <ExternalLink className="size-4" aria-hidden />
            <span className="hidden sm:inline">עמוד ההזמנות</span>
          </Link>

          {/* The full calendar is a sibling view of this one rather than a nav
              entry: an owner arrives at "today" and reaches for it from here,
              not from a menu two taps away.

              It is the one **gradient** control on this page. That is the
              documented use of the brand ramp — the thing being recommended —
              and it sits at the outer edge, which is the easiest place on a
              phone to hit. */}
          <Link
            href="/dashboard/agenda/full"
            className="inline-flex items-center gap-2 rounded-full bg-[image:var(--brand-gradient)] px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/25 transition-all hover:shadow-lg hover:brightness-110 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px dark:focus-visible:ring-offset-zinc-950"
          >
            <CalendarRange className="size-4" aria-hidden />
            יומן מלא
          </Link>
        </div>
      </header>

      <TodaySummary
        todayCount={stats.todayCount}
        weekCount={stats.weekCount}
        upcomingCount={stats.upcomingCount}
        pastCount={stats.pastCount}
        cancelledCount={stats.cancelledCount}
        noShowCount={stats.noShowCount}
        cancellationRate={toPercent(stats.cancelledCount, stats.pastCount)}
        noShowRate={toPercent(stats.noShowCount, stats.pastCount)}
        todayRevenueCents={stats.todayRevenueCents}
        newClientsThisWeek={stats.newClientsThisWeek}
        ratesWindowDays={RATES_WINDOW_DAYS}
      />

      {/* Both lists share one optimistic status, because the *same* request can
          be in both: approving it in the panel has to empty the panel and flip
          the row in the agenda below on the same click. See
          `appointment-status-store`. */}
      <AppointmentStatusProvider>
        {/* Above the agenda, because it is the only thing on this page that is
          waiting on the owner rather than merely informing them. */}
        <PendingRequests
          timezone={business.timezone}
          appointments={requests.map((a) => ({
            id: a.id,
            startsAt: a.startsAt.toISOString(),
            endsAt: a.endsAt.toISOString(),
            status: a.status,
            clientName: a.clientName,
            clientPhone: a.clientPhone,
            serviceName: a.serviceName,
            priceCents: a.priceCents,
            notes: a.notes,
          }))}
        />

        <AgendaView
          /* Both halves, resolved server-side: the tenant must be entitled *and*
           the deploy must have a key. Either missing and the microphone is not
           rendered — no paywall teaser on a toolbar icon, and no control that
           cannot work. */
          canUseVoice={
            entitlementsFor(business).canAccessLibi && isLibiConfigured()
          }
          upcomingCount={stats.upcomingCount}
          nextUpcoming={
            nextUpcoming
              ? {
                  date: formatInTimeZone(
                    nextUpcoming.startsAt,
                    business.timezone,
                    "yyyy-MM-dd",
                  ),
                  time: formatInTimeZone(
                    nextUpcoming.startsAt,
                    business.timezone,
                    "HH:mm",
                  ),
                  clientName: nextUpcoming.clientName,
                }
              : null
          }
          today={today}
          selectedDate={day}
          timezone={business.timezone}
          services={services.map((s) => ({
            id: s.id,
            name: s.name,
            durationMin: s.durationMin,
          }))}
          staff={team.map((member) => ({ id: member.id, name: member.name }))}
          appointments={appointments.map((a) => ({
            id: a.id,
            startsAt: a.startsAt.toISOString(),
            endsAt: a.endsAt.toISOString(),
            status: a.status,
            clientName: a.clientName,
            clientPhone: a.clientPhone,
            serviceName: a.serviceName,
            priceCents: a.priceCents,
            notes: a.notes,
          }))}
        />
      </AppointmentStatusProvider>
    </div>
  );
}
