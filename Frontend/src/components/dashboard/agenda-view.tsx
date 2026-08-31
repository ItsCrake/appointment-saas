"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";

import { AgendaList, type AgendaAppointment } from "./agenda-list";
import { LibiButton } from "./libi-button";
import { ManualBookingDialog } from "./manual-booking-dialog";
import { dayOfMonth, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type ServiceOption = { id: string; name: string; durationMin: number };
type StaffOption = { id: string; name: string };

export type NextUpcoming = {
  date: string;
  time: string;
  clientName: string;
};

/**
 * The dashboard agenda: **one day, always.**
 *
 * ---------------------------------------------------------------------------
 * This used to carry a day/week toggle, and the week it offered was a worse
 * version of the one `/dashboard/agenda/full` already renders — a flat list of
 * seven headings rather than a grid, with no blocks, no staff and no sense of
 * shape. Two answers to the same question, one of them plainly weaker, and the
 * toggle sat where an owner's thumb lands first.
 *
 * So this route is now what its title says: today, and the arrows either side of
 * it. The week is one tap away through the header's own link to the full
 * calendar, which is the view built to answer it.
 * ---------------------------------------------------------------------------
 */
export function AgendaView({
  today,
  selectedDate,
  timezone,
  services,
  staff,
  appointments,
  upcomingCount,
  nextUpcoming,
  canUseVoice,
}: {
  today: string;
  selectedDate: string;
  timezone: string;
  services: ServiceOption[];
  /** Who a manual booking may be assigned to. Active providers, in roster order. */
  staff: StaffOption[];
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

  const prev = shift(selectedDate, -1);
  const next = shift(selectedDate, 1);

  /**
   * The day's appointments, matched on the *business-local* date.
   *
   * Still filtered here rather than trusted from the query: the server fetches
   * a UTC range, and an appointment at 23:30 in a +03 shop belongs to a
   * different calendar day than the one its instant falls on in UTC.
   */
  const dayAppointments = appointments.filter(
    (appointment) =>
      formatInTimeZone(
        new Date(appointment.startsAt),
        timezone,
        "yyyy-MM-dd",
      ) === selectedDate,
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* One bordered group rather than three loose buttons, and "היום" is
            always rendered.

            It used to appear only when the owner had navigated away, so the
            row reflowed and every control beside it moved the moment they
            stepped a day forward — the worst possible behaviour for someone
            aiming a thumb between clients. Present and marked as current costs
            one segment and holds the layout still. */}
        <nav
          className="flex items-center overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          aria-label="ניווט בתאריכים"
        >
          {/* RTL: "previous" sits on the right, so the chevron points that way. */}
          <ArrowLink
            href={`/dashboard?date=${prev}`}
            label="הקודם"
            icon={<ChevronRight className="size-4" aria-hidden />}
          />
          <Link
            href="/dashboard"
            aria-current={selectedDate === today ? "date" : undefined}
            className={cn(
              "border-x border-zinc-200 px-3 py-2 text-xs font-semibold transition-colors dark:border-zinc-800",
              /**
               * Quiet when you are already on today, loud when you are not —
               * which is the reverse of what this used to do.
               *
               * It filled grey on today, and a filled grey control between two
               * arrows reads as disabled: the one state where the button has
               * nothing to do was the state that drew the eye. Now the fill
               * means "there is somewhere to go back to", so it appears exactly
               * when it is worth pressing. Ink rather than the brand gradient —
               * the gradient is reserved for what is active or recommended, and
               * this is an ordinary primary action.
               */
              selectedDate === today
                ? "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
            )}
          >
            היום
          </Link>
          <ArrowLink
            href={`/dashboard?date=${next}`}
            label="הבא"
            icon={<ChevronLeft className="size-4" aria-hidden />}
          />
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDialogDate(selectedDate)}
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

      <section>
        {/**
         * **Which day, and how much of it — the two facts an owner opens this
         * page for.**
         *
         * Both used to be `text-xs text-zinc-400`: the same weight as a hint,
         * lighter than every appointment card under them, and the count sat at
         * the far end of a `justify-between` row where nothing led the eye to
         * it. The heading is now the size of the thing it heads, "היום" is
         * marked in the tenant's own accent so today is distinguishable from a
         * date the owner navigated to, and the count is a chip rather than a
         * whisper.
         *
         * `--accent-soft` / `--accent-on-soft` rather than a picked colour:
         * they are the pair `theme-coverage.test.ts` already holds to AA on
         * every tenant accent, and the same pair the calendar's today column
         * uses — so "today" reads identically on both screens.
         */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {selectedDate === today
                ? "היום"
                : `יום ${weekdayLabel(selectedDate)}`}
            </h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                selectedDate === today
                  ? "bg-(--accent-soft) text-(--accent-on-soft)"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {dayOfMonth(selectedDate)}/{month(selectedDate)}
            </span>
          </div>

          {dayAppointments.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white tabular-nums dark:bg-zinc-100 dark:text-zinc-900">
              <CalendarCheck className="size-3.5" aria-hidden />
              {dayAppointments.length === 1
                ? "תור אחד"
                : `${dayAppointments.length} תורים`}
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
            {nextUpcoming && nextUpcoming.date !== selectedDate ? (
              <Link
                href={`/dashboard?date=${nextUpcoming.date}`}
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
              onClick={() => setDialogDate(selectedDate)}
              className="text-xs font-semibold text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
            >
              הוספת תור ידני
            </button>
          </div>
        ) : (
          <AgendaList appointments={dayAppointments} timezone={timezone} />
        )}
      </section>

      {dialogDate ? (
        <ManualBookingDialog
          date={dialogDate}
          services={services}
          staff={staff}
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
      className="p-2.5 text-zinc-600 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      <NavIcon>{icon}</NavIcon>
    </Link>
  );
}

/**
 * Swaps the arrow for a spinner while its navigation is in flight.
 *
 * Changing the day is a server round trip — the agenda is per-tenant, live, and
 * cannot be cached without risking a stale calendar — so some wait is real. What
 * was missing was any sign it had started: the owner tapped, nothing moved for a
 * few hundred milliseconds, and tapped again.
 *
 * Must be a descendant of the `<Link>` it reports on, which is why it is its own
 * component. It replaces the glyph in place rather than adding anything, so the
 * control does not resize and the tap target stays where the thumb left it —
 * the same rule the toolbar's always-rendered "היום" follows.
 */
function NavIcon({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2 className="size-4 animate-spin" aria-hidden />
  ) : (
    children
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
