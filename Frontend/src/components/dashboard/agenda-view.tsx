"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  ArrowLeft,
  CalendarClock,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";

import { AgendaList, type AgendaAppointment } from "./agenda-list";
import { LibiButton } from "./libi-button";
import { ManualBookingDialog } from "./manual-booking-dialog";
import { dayOfMonth, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type ServiceOption = { id: string; name: string; durationMin: number };

export type NextUpcoming = {
  date: string;
  time: string;
  clientName: string;
};

export function AgendaView({
  today,
  selectedDate,
  view,
  days,
  timezone,
  services,
  appointments,
  upcomingCount,
  nextUpcoming,
  canUseVoice,
}: {
  today: string;
  selectedDate: string;
  view: "day" | "week";
  days: string[];
  timezone: string;
  services: ServiceOption[];
  appointments: AgendaAppointment[];
  /** Everything still ahead, across all days. */
  upcomingCount: number;
  nextUpcoming: NextUpcoming | null;
  /**
   * Resolved on the server from the tenant's entitlements and the presence of
   * an API key. Passed in rather than checked here because this is a client
   * component — an entitlement decided in the browser is not a decision.
   */
  canUseVoice: boolean;
}) {
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const router = useRouter();

  const step = view === "week" ? 7 : 1;
  const prev = shift(selectedDate, -step);
  const next = shift(selectedDate, step);

  // Group by the *business-local* day, not the UTC day.
  const byDay = new Map<string, AgendaAppointment[]>();
  for (const day of days) byDay.set(day, []);
  for (const appointment of appointments) {
    const key = formatInTimeZone(
      new Date(appointment.startsAt),
      timezone,
      "yyyy-MM-dd",
    );
    byDay.get(key)?.push(appointment);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
          {(["day", "week"] as const).map((value) => (
            <Link
              key={value}
              href={`/dashboard?view=${value}&date=${selectedDate}`}
              aria-current={view === value ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                view === value
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
              )}
            >
              {value === "day" ? "יום" : "שבוע"}
            </Link>
          ))}
        </div>

        <nav className="flex items-center gap-1" aria-label="ניווט בתאריכים">
          {/* RTL: "previous" sits on the right, so the chevron points that way. */}
          <ArrowLink
            href={`/dashboard?view=${view}&date=${prev}`}
            label="הקודם"
            icon={<ChevronRight className="size-4" aria-hidden />}
          />
          <ArrowLink
            href={`/dashboard?view=${view}&date=${next}`}
            label="הבא"
            icon={<ChevronLeft className="size-4" aria-hidden />}
          />
        </nav>

        {selectedDate !== today ? (
          <Link
            href={`/dashboard?view=${view}`}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            היום
          </Link>
        ) : null}

        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setDialogDate(view === "week" ? days[0] : selectedDate)
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800"
          >
            <Plus className="size-4" aria-hidden />
            תור ידני
          </button>

          {/* Libi sits beside manual booking because it is the same job done a
              faster way, not a different feature. Rendered only for a tenant
              entitled to it *and* on a deploy with a key — the component
              removes itself when the browser cannot do speech recognition. */}
          {canUseVoice ? (
            <LibiButton services={services} onBooked={() => router.refresh()} />
          ) : null}
        </div>
      </div>

      <div className="space-y-6">
        {days.map((day) => {
          const dayAppointments = byDay.get(day) ?? [];

          return (
            <section key={day}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {day === today ? "היום" : `יום ${weekdayLabel(day)}`}
                  <span className="ms-2 text-xs font-normal text-zinc-400">
                    {dayOfMonth(day)}/{month(day)}
                  </span>
                </h2>
                {dayAppointments.length > 0 ? (
                  <span className="text-xs text-zinc-400">
                    {dayAppointments.length} תורים
                  </span>
                ) : null}
              </div>

              {dayAppointments.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-white/50 px-4 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
                  <CalendarOff className="size-5 text-zinc-300" aria-hidden />
                  <p className="text-xs text-zinc-500">אין תורים ביום זה</p>

                  {/*
                    Without this an owner whose bookings are all days away sees
                    an empty today and assumes the booking was lost.
                  */}
                  {nextUpcoming && nextUpcoming.date !== day ? (
                    <Link
                      href={`/dashboard?view=day&date=${nextUpcoming.date}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200"
                    >
                      <CalendarClock className="size-3.5" aria-hidden />
                      {upcomingCount === 1
                        ? "יש תור אחד קרוב"
                        : `יש ${upcomingCount} תורים קרובים`}
                      <span className="opacity-70">
                        · הבא {formatDayLabel(nextUpcoming.date)} בשעה{" "}
                        {nextUpcoming.time}
                      </span>
                      <ArrowLeft className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setDialogDate(day)}
                    className="text-xs font-semibold text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
                  >
                    הוספת תור ידני
                  </button>
                </div>
              ) : (
                <AgendaList
                  appointments={dayAppointments}
                  timezone={timezone}
                />
              )}
            </section>
          );
        })}
      </div>

      {dialogDate ? (
        <ManualBookingDialog
          date={dialogDate}
          services={services}
          onClose={() => setDialogDate(null)}
          onCreated={() => {
            setDialogDate(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function ArrowLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {icon}
    </Link>
  );
}

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function month(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCMonth() + 1;
}

/** "יום ראשון 2/8" — enough for an owner to orient without opening the day. */
function formatDayLabel(date: string) {
  return `יום ${weekdayLabel(date)} ${dayOfMonth(date)}/${month(date)}`;
}
