"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { ManualBookingDialog } from "./manual-booking-dialog";
import { btnPrimary, focusRing } from "./ui";
import { shiftDays } from "@/lib/calendar-week";
import { dayOfMonth, weekdayLabel } from "@/lib/format";
import { createRangeCache, fetchDashboardJson } from "@/lib/range-cache";
import { cn } from "@/lib/utils";

type ServiceOption = { id: string; name: string; durationMin: number };
type StaffOption = { id: string; name: string };

export type NextUpcoming = {
  date: string;
  time: string;
  clientName: string;
};

/** What `/api/dashboard/day` answers — see `loadAgendaDay`. */
type AgendaDay = { date: string; appointments: AgendaAppointment[] };

/**
 * Every day this tab has shown, keyed by tenant and date — see `range-cache`.
 * Module scope, so the days survive a visit to another dashboard page.
 */
const dayCache = createRangeCache<AgendaDay>((key) =>
  fetchDashboardJson<AgendaDay>(
    `/api/dashboard/day?date=${encodeURIComponent(key.split("|")[1] ?? "")}`,
  ),
);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar's timings, for the same reasons — see `WeekCalendar`. */
const SHOWN_MAX_AGE_MS = 10_000;
const PREFETCH_MAX_AGE_MS = 60_000;
const PREFETCH_DELAY_MS = 250;

/** The agenda's own address for a day: bare for today, `?date=` otherwise. */
function dayHref(date: string, today: string) {
  return date === today ? "/dashboard" : `/dashboard?date=${date}`;
}

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
 *
 * **Stepping a day is a change of state, not a navigation.** It used to be a
 * link to `?date=`, and every step re-ran the whole page on the server — the
 * stats, the requests, the services and the staff, none of which depend on the
 * day — behind a full-page skeleton: 2.5–2.9s a step on a production build.
 * The day on screen is now held here, its appointments come from
 * `/api/dashboard/day` (or from memory, when the day was seen or fetched ahead
 * of the tap), and the address bar follows along so a refresh lands in the
 * same place.
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
  scope,
}: {
  today: string;
  /** The day the server rendered — the one in the address bar. */
  selectedDate: string;
  timezone: string;
  services: ServiceOption[];
  /** Who a manual booking may be assigned to. Active providers, in roster order. */
  staff: StaffOption[];
  /** The server's day. Every other day is fetched by the component. */
  appointments: AgendaAppointment[];
  /** Everything still ahead, across all days. */
  upcomingCount: number;
  nextUpcoming: NextUpcoming | null;
  /** Whose days these are — the tenant's id — so the cache never mixes shops. */
  scope: string;
}) {
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const router = useRouter();

  const [shownDate, setShownDate] = useState(selectedDate);

  /**
   * **A navigation wins over wherever the owner had stepped** — the dock's own
   * "היומן", ליבי, a link from elsewhere.
   *
   * Detected on the address bar, not on the server's props. Every step here
   * writes its day into the URL, so the URL only ever disagrees with the day
   * on screen when somebody else changed it. The props cannot say that: a
   * navigation back to the day the page first drew can be answered from the
   * router's cache with the very same objects, and neither a date nor an
   * identity comparison sees it — the agenda stayed on Saturday after a tap
   * that asked for today. Adjusted during render, React's documented way of
   * resetting state on a changed input.
   */
  const searchParams = useSearchParams();
  const requested = searchParams.get("date");
  const urlDate =
    requested && DATE_PATTERN.test(requested) ? requested : today;
  const [seenUrlDate, setSeenUrlDate] = useState(urlDate);
  if (seenUrlDate !== urlDate) {
    setSeenUrlDate(urlDate);
    if (urlDate !== shownDate) setShownDate(urlDate);
  }

  const keyFor = useCallback((date: string) => `${scope}|${date}`, [scope]);
  useSyncExternalStore(dayCache.subscribe, dayCache.version, dayCache.version);

  const serverDay = useMemo<AgendaDay>(
    () => ({ date: selectedDate, appointments }),
    [selectedDate, appointments],
  );

  /**
   * The server's render is the freshest copy there is, and whatever made it
   * render again — a booking made here, a status changed in the list, ליבי —
   * may have changed other days too. Everything held is marked stale, and
   * this day replaces its held copy before the browser paints.
   */
  useLayoutEffect(() => {
    dayCache.invalidate();
    dayCache.put(keyFor(serverDay.date), serverDay);
  }, [serverDay, keyFor]);

  const held =
    dayCache.peek(keyFor(shownDate)) ??
    (shownDate === serverDay.date ? serverDay : undefined);
  const loading = dayCache.isLoading(keyFor(shownDate));

  /**
   * The day on screen is always on its way to being fresh — shared with the
   * step that already asked for it, so this only works for a day that arrived
   * some other way, like a navigation the router answered from its cache.
   */
  useEffect(() => {
    dayCache.load(keyFor(shownDate), SHOWN_MAX_AGE_MS).catch(() => {});
  }, [shownDate, keyFor]);

  // The days either side, fetched once this one has drawn.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      dayCache.prefetch(keyFor(shiftDays(shownDate, -1)), PREFETCH_MAX_AGE_MS);
      dayCache.prefetch(keyFor(shiftDays(shownDate, 1)), PREFETCH_MAX_AGE_MS);
    }, PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shownDate, keyFor]);

  /**
   * Moves the agenda to `date` at once: the heading changes on the tap, and
   * the list is either already in memory or on its way. A failed fetch — an
   * ended session, a dropped network — becomes a real navigation, which says
   * more than a list that never arrives.
   */
  const goToDay = useCallback(
    (date: string) => {
      setShownDate(date);
      window.history.replaceState(null, "", dayHref(date, today));
      dayCache.load(keyFor(date), SHOWN_MAX_AGE_MS).catch(() => {
        window.location.assign(dayHref(date, today));
      });
    },
    [keyFor, today],
  );

  const prev = shiftDays(shownDate, -1);
  const next = shiftDays(shownDate, 1);

  /**
   * The day's appointments, matched on the *business-local* date.
   *
   * Still filtered here rather than trusted from the query: the server fetches
   * a UTC range, and an appointment at 23:30 in a +03 shop belongs to a
   * different calendar day than the one its instant falls on in UTC.
   */
  const dayAppointments = useMemo(
    () =>
      (held?.appointments ?? []).filter(
        (appointment) =>
          formatInTimeZone(
            new Date(appointment.startsAt),
            timezone,
            "yyyy-MM-dd",
          ) === shownDate,
      ),
    [held, timezone, shownDate],
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
          className="glass-inset flex items-center gap-1 rounded-full p-1"
          aria-label="ניווט בתאריכים"
        >
          {/* RTL: "previous" sits on the right, so the chevron points that way. */}
          <DayLink
            href={dayHref(prev, today)}
            label="הקודם"
            onGo={() => goToDay(prev)}
            className={cn(
              "glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
              focusRing,
            )}
          >
            <ChevronRight className="size-4" aria-hidden />
          </DayLink>
          <DayLink
            href="/dashboard"
            onGo={() => goToDay(today)}
            current={shownDate === today}
            className={cn(
              "flex h-9 items-center rounded-full px-4 text-xs font-semibold transition-colors",
              focusRing,
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
              shownDate === today
                ? "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
                : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
            )}
          >
            היום
          </DayLink>
          <DayLink
            href={dayHref(next, today)}
            label="הבא"
            onGo={() => goToDay(next)}
            className={cn(
              "glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
              focusRing,
            )}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </DayLink>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDialogDate(shownDate)}
            className={cn(btnPrimary, "h-10 px-4 text-xs")}
          >
            <Plus className="size-4" aria-hidden />
            תור ידני
          </button>
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
              {shownDate === today ? "היום" : `יום ${weekdayLabel(shownDate)}`}
            </h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                shownDate === today
                  ? "bg-(--accent-soft) text-(--accent-on-soft)"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {dayOfMonth(shownDate)}/{month(shownDate)}
            </span>
            {/* The day already changed; this says its list is on the way —
                whether it is being fetched for the first time or refreshed
                behind a copy from memory. */}
            <span role="status" className="self-center text-zinc-500">
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  <span className="sr-only">טוען את התורים…</span>
                </>
              ) : null}
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

        {!held ? (
          /* A day nobody has seen yet: rows the shape of the list, so it swaps
             in without the page moving. */
          <div aria-hidden className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="animate-shimmer h-20 rounded-2xl" />
            ))}
          </div>
        ) : dayAppointments.length === 0 ? (
          <div className="glass-row flex flex-col items-center gap-2 rounded-3xl px-4 py-8 text-center">
            <span className="glass-bubble flex size-10 items-center justify-center rounded-full">
              <CalendarOff className="size-5 text-zinc-500" aria-hidden />
            </span>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              אין תורים ביום זה
            </p>

            {/*
              Without this an owner whose bookings are all days away sees
              an empty today and assumes the booking was lost.
            */}
            {nextUpcoming && nextUpcoming.date !== shownDate ? (
              <DayLink
                href={dayHref(nextUpcoming.date, today)}
                onGo={() => goToDay(nextUpcoming.date)}
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
              </DayLink>
            ) : null}

            <button
              type="button"
              onClick={() => setDialogDate(shownDate)}
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
            // Every day held is suspect now; the server redraws this one.
            dayCache.invalidate();
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A move to another day, taken in memory.
 *
 * A plain anchor with the day's real address underneath, so a modified click,
 * middle-click and "open in new tab" still work and land in the same place;
 * an ordinary click is `onGo` — see `goToDay`. A plain `<a>` rather than
 * `<Link>`, because the one thing `<Link>` adds is the navigation this
 * replaces, and prefetching a whole route for it would be wasted.
 */
function DayLink({
  href,
  label,
  current,
  onGo,
  className,
  children,
}: {
  href: string;
  label?: string;
  /** Marks today's control while today is on screen. */
  current?: boolean;
  onGo: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      aria-current={current ? "date" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onGo();
      }}
      className={className}
    >
      {children}
    </a>
  );
}

function month(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCMonth() + 1;
}

/** "יום ראשון 2/8" — enough for an owner to orient without opening the day. */
function formatDayLabel(date: string) {
  return `יום ${weekdayLabel(date)} ${dayOfMonth(date)}/${month(date)}`;
}
