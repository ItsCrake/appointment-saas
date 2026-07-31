import type { Metadata } from "next";
import Link from "next/link";
import { fromZonedTime } from "date-fns-tz";
import { ExternalLink } from "lucide-react";

import { AgendaView } from "@/components/dashboard/agenda-view";
import { db } from "@/db";
import { listAppointmentsInRange, listServices } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import { dateRange, todayInTimezone } from "@/lib/format";

export const metadata: Metadata = { title: "היומן" };

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

  const [appointments, services] = await Promise.all([
    listAppointmentsInRange(db, business.id, rangeStart, rangeEnd, [
      "pending",
      "confirmed",
      "completed",
      "no_show",
    ]),
    listServices(db, business.id),
  ]);

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            היומן
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">{business.name}</p>
        </div>

        <Link
          href={`/${business.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          עמוד ההזמנות
        </Link>
      </header>

      <AgendaView
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
