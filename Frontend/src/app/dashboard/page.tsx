import type { Metadata } from "next";
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ExternalLink } from "lucide-react";

import { AgendaView } from "@/components/dashboard/agenda-view";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { db } from "@/db";
import {
  getDashboardStats,
  getNextUpcomingAppointment,
  listAppointmentsInRange,
  listServices,
} from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import { dateRange, todayInTimezone } from "@/lib/format";
import { getStatsWindows, toPercent } from "@/lib/stats";

export const metadata: Metadata = { title: "היומן" };

/** Trailing window the cancellation and no-show rates are measured over. */
const RATES_WINDOW_DAYS = 30;

type PageProps = {
  searchParams: Promise<{ date?: string; view?: string }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Sunday-start week containing `date`, matching the Israeli calendar. */
function weekStart(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() - d.getUTCDay() * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export default async function AgendaPage({ searchParams }: PageProps) {
  const { business } = await requireBusiness();
  const { date, view: rawView } = await searchParams;

  const today = todayInTimezone(business.timezone);
  const day = date && DATE_PATTERN.test(date) ? date : today;
  const view = rawView === "week" ? "week" : "day";

  const days = view === "week" ? dateRange(weekStart(day), 7) : [day];

  // One query for the whole visible range, converted from local days to UTC.
  const rangeStart = fromZonedTime(`${days[0]}T00:00:00`, business.timezone);
  const rangeEnd = new Date(rangeStart.getTime() + days.length * 86_400_000);

  const windows = getStatsWindows(business.timezone);

  const [appointments, services, stats, nextUpcoming] = await Promise.all([
    listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
      "pending",
      "confirmed",
      "completed",
      "no_show",
    ]),
    listServices(db, business.id),
    getDashboardStats(db, business.id, windows),
    getNextUpcomingAppointment(db, business.id, windows.now),
  ]);

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            היומן
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">{business.name}</p>
        </div>

        <Link
          href={`/${business.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          עמוד ההזמנות
        </Link>
      </header>

      <StatsCards
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

      <AgendaView
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
        view={view}
        days={days}
        timezone={business.timezone}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
        }))}
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
    </div>
  );
}
