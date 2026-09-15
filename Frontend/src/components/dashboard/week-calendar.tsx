"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileText,
  Grid2x2,
  Hourglass,
  MessageCircle,
  Mic,
  Phone,
  Rows3,
  Scissors,
  Tag,
  Trash2,
  UserRound,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  createStaffTimeOffAction,
  deleteStaffTimeOffAction,
  type StaffActionResult,
} from "@/app/dashboard/staff/actions";
import { useToast } from "@/components/ui/toast";
import { AppointmentDialog } from "./appointment-dialog";
import {
  assignLanes,
  blockMinHeight,
  cardBox,
  cardHeightPx,
  cardPxForLines,
  gapsToNext,
  gridBounds,
  gridMinWidthPx,
  hourRowPx,
  hourRows,
  lineBudget,
  MAX_CARD_LINES,
  minutesToLabel,
  placeItem,
  type CalendarItem,
  type CardMode,
} from "@/lib/calendar-layout";
import {
  FOCUS_RING_MS,
  CALENDAR_DENSITIES,
  chooseDensity,
  DAY_HEADER_ROW,
  densityServerSnapshot,
  densitySnapshot,
  DENSITY,
  subscribeDensity,
  SUMMARY_HOUR_ROW,
  type CalendarDensity,
} from "@/lib/calendar-density";
import { formatPrice } from "@/lib/format";
import { staffSwatch } from "@/lib/staff-colors";
import {
  staffToneClass,
  staffVariantClass,
  staffVariants,
} from "@/lib/staff-variants";
import {
  marksTheCard,
  type AppointmentOrigin,
} from "@/lib/appointment-origin";
import { cn } from "@/lib/utils";
import { whatsappHref } from "@/lib/whatsapp-link";

import {
  btnPrimary,
  cardClass,
  focusRing,
  inputClass,
  NotesBadge,
  STATUS_LABEL,
  StatusChip,
  type AppointmentStatusName,
} from "./ui";

const WEEKDAY_SHORT = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

/**
 * The switcher's marks, in the order the modes widen.
 *
 * Shapes rather than words, and shapes that describe the *layout* each mode
 * produces: rows of readable cards, many narrow columns, a grid of blocks. The
 * name is still there for anyone who cannot see them — see the `sr-only` label
 * on each button.
 */
const DENSITY_ICON: Record<CalendarDensity, typeof Rows3> = {
  standard: Rows3,
  compact: Columns3,
  summary: Grid2x2,
};

export type CalendarEntry = CalendarItem & {
  /**
   * The appointment row's id, or null for a block.
   *
   * Distinct from `id`, which is per *span* — a booking that crosses midnight
   * draws one card a day and they must not share a React key. Every action
   * needs the row, so it is carried separately rather than parsed back out.
   */
  appointmentId: string | null;
  kind: "appointment" | "block";
  /** Client name for an appointment; the reason for a block. */
  title: string;
  /** Service name for an appointment; who and when for a block. */
  subtitle: string | null;
  /** Appointments only — powers the call and WhatsApp links in the hover card. */
  clientPhone: string | null;
  /** What the client typed when booking. Null when they typed nothing. */
  notes: string | null;
  /**
   * What the *owner* has saved about this client, keyed by phone — not tied to
   * this booking. Deliberately separate from `notes`: one is a request for
   * today, the other is what the shop knows about the person, and merging them
   * would make a standing preference look like something they just asked for.
   */
  clientProfileNotes: string | null;
  /**
   * Which route wrote this booking (0034).
   *
   * Only `voice` marks the card. A badge on every card is wallpaper — the
   * eye stops reading it by the second row — and the question an owner
   * has is "did ליבי put that there", not "which of three routes".
   */
  origin: AppointmentOrigin;
  status: string | null;
  priceCents: number | null;
  /** Who holds it, for seeding the dialog's provider picker. */
  staffId: string | null;
  staffName: string | null;
  staffColor: string | null;
  /** Present for blocks, so they can be removed from here. */
  timeOffId: string | null;
  /**
   * The entry's **own** wall clock in the business timezone — the appointment's
   * date and times, not the span's.
   *
   * A span is clipped at midnight, so its minutes describe a card rather than a
   * booking; seeding a reschedule form from them would offer 00:00 as the start
   * time of something that began the evening before. Resolved on the server,
   * like every other date on this grid, because the browser's zone is not the
   * shop's.
   */
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * **One hour of grid is no longer a class.** It was `h-24` in the week and
 * `h-40` in the day, and a quarter-hour booking back to back with another got
 * 22px — one line, with the time and the service gone exactly when the day was
 * busy. The hour is now `hourRowPx`, grown until the shortest booking in the
 * loaded week holds everything its mode promises, and applied as one pixel
 * height to the rail and to every day column alike: a difference of a single
 * pixel between the two would shear the week, and the times on the left would
 * stop describing the cards on the right. The overview is the exception — its
 * hour is `SUMMARY_HOUR_ROW`, sized by the stylesheet to fit the frame.
 */

/**
 * **The card's type, with its line-height inside the size class.**
 *
 * Never as a separate `leading-*`: `cn()` is `tailwind-merge`, and it deletes a
 * `leading-*` that comes before a text-size utility, because in Tailwind v4 the
 * size carries a line-height of its own. That is exactly how this card rendered
 * 15px lines under a line budget that believed they were 12, and sliced the
 * glyphs of every line it could not fit. Written as `size/line-height` the two
 * are one class and cannot be separated.
 *
 * Transcribed into `CARD_LINE_PX` in `calendar-layout`, which the line budget is
 * arithmetic on — `calendar-layout.test.ts` fails if they drift apart, and fails
 * if a bare `leading-*` reappears in the card's classes.
 */
const CARD_TYPE_WEEK = "text-[10px]/[14px]";
const CARD_TYPE_DAY = "text-xs/5 sm:text-sm/5";

/** One line's box, for the row that sets a name beside its marks. */
const CARD_ROW_WEEK = "h-3.5";
const CARD_ROW_DAY = "h-5";

/**
 * Vertical padding of the text column — `CARD_PADDING_PX`. Tight when the card
 * carries a single line, which is what lets a back-to-back quarter hour show a
 * whole name.
 */
const CARD_PAD = {
  week: { roomy: "py-1", tight: "py-0.5" },
  day: { roomy: "py-1.5", tight: "py-1" },
} as const;

export type CalendarDay = {
  /** "YYYY-MM-DD" in the business timezone. */
  date: string;
  /** "12.8", for the column head. */
  label: string;
  weekday: number;
  isToday: boolean;
  /** Open hours, so the grid covers the shop even on an empty week. */
  open: { startMinutes: number; endMinutes: number }[];
};

/**
 * The week calendar.
 *
 * ---------------------------------------------------------------------------
 * Every position on this grid is a percentage, computed by `calendar-layout`
 * from minutes and day indices the server already resolved into the shop's
 * timezone. Nothing here measures an element, listens for a resize, or knows
 * what a timezone is — which is why the same markup works on a phone and on a
 * monitor without a layout effect anywhere.
 *
 * **Custom blocks are `time_off` rows.** That is the whole trick: `time_off`
 * already blocks availability, business-wide or per staff member, and is
 * already covered by the availability tests. A separate "calendar event" table
 * would have needed its own blocking path, and the two would have drifted the
 * first time somebody fixed one of them.
 * ---------------------------------------------------------------------------
 */
export type CalendarView = "day" | "week";

export function WeekCalendar({
  initialView,
  initialDate,
  days: weekDays,
  entries,
  weekStart,
  previousWeek,
  nextWeek,
  thisWeek,
  staff,
  timezone,
  focusAppointmentId,
}: {
  initialView: CalendarView;
  /** The focused day, "YYYY-MM-DD". Only meaningful in the day view. */
  initialDate: string;
  /** Always the full week, whichever view is showing. */
  days: CalendarDay[];
  entries: CalendarEntry[];
  weekStart: string;
  previousWeek: string;
  nextWeek: string;
  thisWeek: string;
  staff: { id: string; name: string; color: string }[];
  timezone: string;
  /**
   * An appointment to scroll to and ring, from `?focus=` (0033).
   *
   * ליבי puts it there: "תראי לי את התור של דנה ביום רביעי" navigates
   * here and the owner arrives looking at a week, which is not the same
   * as arriving looking at the booking they asked about. Matched on
   * `appointmentId` rather than `id`, since a booking crossing midnight
   * is two cards sharing one row.
   */
  focusAppointmentId?: string;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  // One at a time, held at the root so the card can be positioned `fixed` and
  // escape the grid's scroll clipping. See `EntryPopover`.
  const [hovered, setHovered] = useState<HoveredEntry | null>(null);
  /** The appointment whose dialog is open, if any. */
  const [opened, setOpened] = useState<CalendarEntry | null>(null);
  /**
   * The ring ליבי put on a booking, and how it goes away.
   *
   * -------------------------------------------------------------------------
   * **It used to have no timeout at all.** The id lives in `?focus=`, so the
   * highlight stayed until the owner navigated — long after the sentence that
   * caused it, on a calendar they had moved on to using for something else. A
   * marker that outlives its conversation stops meaning "this one" and starts
   * meaning nothing.
   *
   * Two ways out, whichever comes first: eight seconds, or the next thing the
   * owner does. The interaction one is the important half — somebody who has
   * started clicking has already found it, and the ring is then just paint on
   * a calendar they are reading.
   *
   * The URL is cleaned up with it, so a refresh does not bring back a
   * highlight the owner has already dismissed. `replace`, not `push`: this is
   * not a place in history anybody wants to go back to.
   * -------------------------------------------------------------------------
   */
  /**
   * Which id has been dismissed, rather than which is showing.
   *
   * Stored as the *dismissed* id so the ring is derived rather than mirrored:
   * a new `?focus=` un-dismisses itself by simply not matching, and nothing
   * has to write state from inside an effect to keep the two in step. The
   * repository forbids that pattern for the usual reason — a render whose only
   * job is correcting the one before it.
   */
  const [dismissedFocus, setDismissedFocus] = useState<string | undefined>();
  const focused =
    focusAppointmentId && focusAppointmentId !== dismissedFocus
      ? focusAppointmentId
      : undefined;

  useEffect(() => {
    if (!focusAppointmentId) return;

    document
      .getElementById(`entry-${focusAppointmentId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });

    const clear = () => {
      setDismissedFocus(focusAppointmentId);
      const url = new URL(window.location.href);
      if (url.searchParams.has("focus")) {
        url.searchParams.delete("focus");
        window.history.replaceState(null, "", url.toString());
      }
    };

    const timer = setTimeout(clear, FOCUS_RING_MS);
    // `once`, so the listeners take themselves off with the first interaction.
    window.addEventListener("pointerdown", clear, { once: true });
    window.addEventListener("keydown", clear, { once: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", clear);
      window.removeEventListener("keydown", clear);
    };
  }, [focusAppointmentId]);
  const router = useRouter();

  /**
   * View and focused day are **client state seeded from the server**, not props
   * read on every render.
   *
   * They used to be links, so every toggle and every step between two days of
   * the same week was a full RSC round trip — for data the browser already had,
   * since the server now always sends the week. Holding them here makes both
   * instant, and `history.replaceState` keeps the URL honest so a refresh or a
   * shared link still lands where the owner was.
   */
  const [view, setView] = useState<CalendarView>(initialView);
  const [focusedDate, setFocusedDate] = useState(initialDate);

  /**
   * How much of the week to fit on screen — see `lib/calendar-density.ts`.
   *
   * Subscribed to rather than held here: the preference lives in
   * `localStorage`, which is an external store, and reading it through
   * `useSyncExternalStore` is what lets the server render the default, hydrate
   * against matching markup, and swap to the owner's choice without a render
   * pass whose only job is correcting the one before it.
   */
  const density = useSyncExternalStore(
    subscribeDensity,
    densitySnapshot,
    densityServerSnapshot,
  );

  const dayView = view === "day";
  const spec = DENSITY[density];
  /**
   * What every card on this grid shows. The day view has one column and
   * nothing to compress sideways, so density does not reach it: it always
   * draws full cards.
   */
  const cardMode: CardMode = dayView ? "full" : spec.card;
  const summaryCards = cardMode === "block";

  /**
   * The shortest appointment in the **loaded week**, which the hour grows to
   * fit — see `hourRowPx`.
   *
   * The week rather than the column on screen, so stepping between days in the
   * day view keeps one scale instead of jumping with each day's shortest
   * booking. Blocks are left out: a ten-minute break has no three lines to
   * hold, and should not make every booking's hour taller.
   */
  const shortestMinutes = useMemo(() => {
    let shortest: number | null = null;
    for (const entry of entries) {
      if (entry.kind !== "appointment") continue;
      const minutes = entry.endMinutes - entry.startMinutes;
      if (minutes > 0 && (shortest === null || minutes < shortest)) {
        shortest = minutes;
      }
    }
    return shortest;
  }, [entries]);

  const rowPx = hourRowPx(dayView ? "day" : "week", cardMode, shortestMinutes);

  /**
   * One hour of grid, as the rail and every column draw it. A pixel height
   * everywhere but the overview, whose row the stylesheet fits to the frame.
   */
  const hourRow = summaryCards
    ? { className: SUMMARY_HOUR_ROW }
    : { style: { height: rowPx } };

  const focusedIndex = Math.max(
    0,
    weekDays.findIndex((day) => day.date === focusedDate),
  );

  /**
   * The columns actually on screen, and the entries remapped onto them.
   *
   * In the day view `dayIndex` has to be rewritten to 0, because everything
   * downstream — lane assignment, placement — indexes by column and there is
   * only one. Filtering without remapping would place every card in a column
   * that does not exist.
   */
  const { days, visibleEntries } = useMemo(() => {
    if (!dayView) return { days: weekDays, visibleEntries: entries };

    return {
      days: weekDays.slice(focusedIndex, focusedIndex + 1),
      visibleEntries: entries
        .filter((entry) => entry.dayIndex === focusedIndex)
        .map((entry) => ({ ...entry, dayIndex: 0 })),
    };
  }, [dayView, weekDays, entries, focusedIndex]);

  // Tailwind cannot build a class from a runtime value, so the template is an
  // inline style — the same reason `data-accent` exists on the booking page.
  const gridTemplate = `3rem repeat(${days.length}, minmax(0, 1fr))`;

  /**
   * Which providers had to share a colour, and the texture each one gets.
   *
   * Derived from the **roster** rather than from the entries on screen, so a
   * person keeps their texture on a day they happen to have no bookings — and
   * so the legend and the grid cannot disagree about it. Someone deactivated
   * since a booking was taken is absent here and falls back to the solid bar,
   * which is right: there is nobody left to confuse them with.
   */
  const variants = useMemo(() => staffVariants(staff), [staff]);

  /**
   * Memoised because they are the expensive part and they are recomputed on
   * every render otherwise — including on each hover, which sets state at the
   * root. Lane assignment is O(n²) within a day and was running for all seven
   * columns every time the pointer crossed a card.
   */
  const bounds = useMemo(
    () =>
      gridBounds(
        visibleEntries,
        days.flatMap((day) => day.open),
        // The overview fits the working day to the screen, so it spends no row
        // on the empty hour either side.
        summaryCards ? 0 : 1,
      ),
    [visibleEntries, days, summaryCards],
  );
  const rows = useMemo(() => hourRows(bounds), [bounds]);

  // Lanes are assigned per day: an overlap on Tuesday must not narrow Monday.
  const placedByDay = useMemo(
    () =>
      days.map((_, dayIndex) =>
        assignLanes(visibleEntries.filter((e) => e.dayIndex === dayIndex)),
      ),
    [days, visibleEntries],
  );

  /**
   * How much room each card may grow into before it would reach the next
   * booking in its lane — what caps the minimum height on a short appointment.
   * Per day, for the same reason lanes are: Tuesday must not constrain Monday.
   */
  const gapsByDay = useMemo(
    () => placedByDay.map((placed) => gapsToNext(placed)),
    [placedByDay],
  );

  /**
   * How wide the grid needs to be for nothing on it to be squashed.
   *
   * Derived from the **lanes actually on screen** rather than a fixed number,
   * because the thing that narrows a column is overlap: a one-chair shop has one
   * lane a day and fits comfortably, while three providers busy at the same hour
   * turn one column into three slivers. See `gridMinWidthPx`.
   *
   * **The lane width itself now comes from the density**, which is the whole
   * mechanism behind the switcher: `standard` asks for the 144px a readable
   * card needs, `compact` for 52 and `summary` for 28. The result stays a
   * *minimum* — the columns are `minmax(0, 1fr)` and stretch to fill — so a
   * quiet week in a narrow mode uses the whole screen rather than huddling at
   * one edge.
   *
   * The day view is excluded: one column has nothing to compress sideways, and
   * narrowing it would shrink the view whose entire purpose is being read.
   */
  const minWidthPx = useMemo(
    () =>
      gridMinWidthPx(
        placedByDay.map((placed) =>
          placed.reduce((widest, item) => Math.max(widest, item.lanes), 1),
        ),
        dayView ? undefined : spec.lanePx,
      ),
    [placedByDay, dayView, spec.lanePx],
  );

  /**
   * Keeps the address bar in step without navigating.
   *
   * `replaceState` rather than `router.replace`: the latter re-runs the server
   * component, which is exactly the round trip this whole change removes. The
   * URL is a bookmark here, not a data source — the data for the week is
   * already in memory.
   */
  const syncUrl = useCallback((nextView: CalendarView, nextDate: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    url.searchParams.set("week", nextDate);
    window.history.replaceState(null, "", url);
  }, []);

  const showView = useCallback(
    (next: CalendarView) => {
      setView(next);
      syncUrl(next, next === "day" ? focusedDate : weekStart);
    },
    [focusedDate, weekStart, syncUrl],
  );

  /** Steps within the loaded week; returns false when it would leave it. */
  const stepDay = useCallback(
    (delta: number) => {
      const next = weekDays[focusedIndex + delta];
      if (!next) return false;
      setFocusedDate(next.date);
      syncUrl("day", next.date);
      return true;
    },
    [weekDays, focusedIndex, syncUrl],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Order is DOM order, and the document is `dir="rtl"`, so the first
            child renders **rightmost**.

            Previous therefore comes first and next comes last, which puts back
            on the right and forward on the left — the direction Hebrew reads.
            It was the other way round, so the pair pointed correctly but sat
            swapped: the left-pointing chevron, which means forward, was on the
            right where a reader reaches for "back". */}
        <div className="flex items-center gap-1">
          <ArrowButton
            label={dayView ? "היום הקודם" : "השבוע הקודם"}
            href={`?view=${view}&week=${previousWeek}`}
            // In the day view a step usually stays inside the week already in
            // memory, so it is instant; only crossing the boundary navigates.
            onStep={dayView ? () => stepDay(-1) : undefined}
          >
            <ChevronRight className="size-4" aria-hidden />
          </ArrowButton>

          <Link
            href={`?view=${view}&week=${thisWeek}`}
            className={cn(
              "glass-control inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-zinc-900 dark:text-zinc-100",
              focusRing,
            )}
          >
            {dayView ? "היום" : "השבוע"}
          </Link>

          <ArrowButton
            label={dayView ? "היום הבא" : "השבוע הבא"}
            href={`?view=${view}&week=${nextWeek}`}
            onStep={dayView ? () => stepDay(1) : undefined}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </ArrowButton>
        </div>

        {/**
         * **How much of the week to fit, offered only where there is a week.**
         *
         * Hidden in the day view rather than disabled: density is a statement
         * about columns, and the day view has one. A greyed-out control there
         * would be three buttons explaining that they do not apply.
         *
         * Icon-only, with the label carried by `aria-label` and `title` — this
         * sits beside the day/week toggle in a header that already runs to two
         * rows on a phone, and three more words of chrome is what pushes it to
         * three. The pressed state is the same white-on-zinc pill the toggle
         * beside it uses, so the two read as one family of controls.
         */}
        {dayView ? null : (
          <div
            role="group"
            aria-label="צפיפות התצוגה"
            className="glass-inset flex items-center gap-1 rounded-full p-1"
          >
            {CALENDAR_DENSITIES.map((value) => {
              const Icon = DENSITY_ICON[value];
              const active = density === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseDensity(value)}
                  aria-pressed={active}
                  aria-label={DENSITY[value].hint}
                  title={DENSITY[value].hint}
                  className={cn(
                    // 36px square: the floor for a thumb, and the same height
                    // as the toggle it sits beside.
                    "flex size-9 items-center justify-center rounded-full transition-colors",
                    focusRing,
                    active
                      ? "glass-control text-zinc-950 dark:text-zinc-50"
                      : // zinc-600 in light: zinc-500 measured 4.44:1 on the old zinc-100
                        // track — under AA for the view toggle's text beside it — and the
                        // set-in glass track is no darker. zinc-400 in dark clears it with
                        // room now that the track is near-ink rather than zinc-800.
                        "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="sr-only">{DENSITY[value].label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Buttons, not links: the whole week is already loaded, so switching
            view is a state change rather than a navigation. */}
        <div
          role="group"
          aria-label="תצוגת יומן"
          className="glass-inset flex items-center gap-1 rounded-full p-1"
        >
          {(
            [
              ["day", "יומי"],
              ["week", "שבועי"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => showView(value)}
              aria-pressed={view === value}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
                focusRing,
                view === value
                  ? "glass-control text-zinc-950 dark:text-zinc-50"
                  : // See the density switch beside it: one family, one measurement.
                    "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAdding(days[0]?.date ?? weekStart)}
          className={cn(btnPrimary, "h-9 px-4 text-xs")}
        >
          <CalendarPlus className="size-4" aria-hidden />
          אירוע חדש
        </button>
      </div>

      {staff.length > 1 ? (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {staff.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
            >
              {/* The key carries the texture too, or it stops being a key.
                  Distinguishing two same-coloured providers on the grid while
                  the legend shows them as one identical dot moves the question
                  rather than answering it. */}
              <span
                aria-hidden
                className={cn(
                  "size-2.5 rounded-full",
                  staffSwatch(member.color).dot,
                  staffVariantClass(variants.get(member.id)),
                )}
              />
              {member.name}
            </li>
          ))}
        </ul>
      ) : null}

      {/**
       * One scroll container: the seven columns keep a usable width on a phone
       * by scrolling sideways rather than compressing to nothing.
       *
       * ---------------------------------------------------------------------
       * **It scrolls vertically too, and that is what makes the day header
       * stick.** `overflow-x: auto` alone does not leave the other axis
       * `visible` — CSS computes `overflow-y` to `auto` the moment one axis is
       * not `visible`, so this element was *already* a scroll container in both
       * directions. It simply had no height to scroll within, so the page
       * scrolled instead and a `position: sticky` header inside it had nothing
       * to stick to: sticky resolves against the nearest scrollport, and this
       * one was exactly as tall as its content.
       *
       * Bounding the height is therefore not decoration around the sticky
       * header — it is the thing that makes sticky work at all. A viewport
       * unit rather than a pixel offset because what has to fit is "the screen
       * minus the chrome around it", and that chrome differs between a phone
       * with a bottom bar and a desktop with a sidebar. `dvh` rather than `vh`
       * so a mobile browser collapsing its address bar does not leave the
       * calendar overshooting the window it is measured against.
       * ---------------------------------------------------------------------
       */}
      <div
        className={cn(
          cardClass,
          "glass-frame overflow-auto overscroll-x-contain",
          "max-h-[68dvh] sm:max-h-[76dvh]",
        )}
      >
        {/**
         * The floor that keeps cards readable, in pixels rather than a fixed
         * `min-w-*`: it has to answer to how many lanes are on screen, and a
         * class cannot be built from a runtime number.
         *
         * The day view gets it too, which it did not before. One column is not
         * automatically roomy — a morning with three providers overlapping
         * splits it three ways just as the week view does — so the same rule
         * applies and only the column count differs.
         */}
        <div style={{ minWidth: `${minWidthPx}px` }}>
          {/**
           * **The day and date stay on screen at every scroll depth.**
           *
           * An owner scrolling to an 18:00 booking was reading a column with
           * nothing above it saying which day it was — worst on a phone, where
           * one screen holds about three hours and the header leaves almost
           * immediately.
           *
           * **Frosted, not transparent.** A sticky row with a transparent
           * background let the cards it sits over show straight through, which
           * read as a rendering fault — so it was made opaque. `.glass-header`
           * is the third answer: what passes beneath is diffused into the
           * surface, so the grid visibly scrolls *under* the day rather than
           * through it, and the day labels stay on a surface at least 80% paper.
           *
           * `z-20` clears `hover:z-10` on the cards, which is the only other
           * stacking level in this grid.
           */}
          <div
            className={cn(
              "sticky top-0 z-20 grid border-b border-zinc-200/80 dark:border-zinc-800/80",
              "glass-header",
            )}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div />
            {days.map((day) => (
              <div
                key={day.date}
                className={cn(
                  // A fixed height rather than padding around two lines of
                  // type: the overview fits its hours into the frame by
                  // subtracting exactly this, and a header that grew with its
                  // font would push the day's last hour off the screen.
                  "flex flex-col items-center justify-center px-1 text-center",
                  DAY_HEADER_ROW,
                  day.isToday && "bg-(--accent-soft)",
                )}
              >
                {/* zinc-600, not 500: over a frosted row a tinted card can pass
                    beneath, and 11px type needs the margin 500 does not have. */}
                <p className="text-[11px] leading-tight text-zinc-600 dark:text-zinc-400">
                  {WEEKDAY_SHORT[day.weekday]}
                </p>
                <p
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    day.isToday
                      ? "text-(--accent-on-soft)"
                      : "text-zinc-900 dark:text-zinc-100",
                  )}
                >
                  {day.label}
                </p>
              </div>
            ))}
          </div>

          <div
            className="grid"
            style={
              {
                gridTemplateColumns: gridTemplate,
                // How many hours `.cal-summary-row` shares the frame between.
                "--cal-rows": rows.length,
              } as CSSProperties
            }
          >
            {/* Hour rail */}
            <div>
              {rows.map((hour) => (
                <div
                  key={hour}
                  style={hourRow.style}
                  className={cn(
                    hourRow.className,
                    "relative border-b border-zinc-100 dark:border-zinc-800/60",
                  )}
                >
                  <span className="absolute end-1 -top-2 text-[10px] text-zinc-400 tabular-nums">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            {days.map((day, dayIndex) => (
              <div
                key={day.date}
                className={cn(
                  "relative border-s border-zinc-100 dark:border-zinc-800/60",
                  day.isToday && "bg-(--accent-soft)/40",
                )}
              >
                {rows.map((hour) => (
                  <div
                    key={hour}
                    style={hourRow.style}
                    className={cn(
                      hourRow.className,
                      "border-b border-zinc-100 dark:border-zinc-800/60",
                    )}
                  />
                ))}

                {/* Open hours, painted behind everything so closed time reads
                    as closed rather than as merely empty. */}
                {day.open.map((span, index) => {
                  const box = placeItem(
                    { ...span, id: "", dayIndex, lane: 0, lanes: 1 },
                    bounds,
                  );
                  return (
                    <div
                      key={index}
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bg-zinc-50 dark:bg-zinc-800/30"
                      style={{ top: `${box.top}%`, height: `${box.height}%` }}
                    />
                  );
                })}

                {placedByDay[dayIndex].map((entry) => {
                  const toNext = gapsByDay[dayIndex].get(entry.id) ?? null;
                  // The gap is what stops the minimum height drawing this card
                  // over the one after it — see `placeItem`.
                  const box = placeItem(entry, bounds, undefined, toNext);
                  return (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      focused={entry.appointmentId === focused}
                      dayView={dayView}
                      variant={
                        entry.staffId ? (variants.get(entry.staffId) ?? 0) : 0
                      }
                      card={cardMode}
                      /**
                       * Every mode's floor, capped by the room to the next card
                       * below and less the gap that keeps them apart — measured
                       * on the grid this card is actually drawn on. In pixels on
                       * the grown hour; as a percentage of the grid in the
                       * overview, whose hour only the stylesheet knows.
                       */
                      minHeight={
                        summaryCards
                          ? blockMinHeight(toNext, bounds)
                          : cardHeightPx(
                              entry.endMinutes - entry.startMinutes,
                              dayView ? "day" : "week",
                              toNext,
                              cardMode,
                              rowPx,
                            )
                      }
                      onHoverChange={setHovered}
                      onOpen={(target) => {
                        // The hover card is supplementary detail about what is
                        // under the cursor. Once the dialog is up it is stale
                        // and floating over a modal, so it goes.
                        setHovered(null);
                        setOpened(target);
                      }}
                      style={cardBox(box)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Suppressed while the dialog is open: the two describe the same
          appointment, and the tooltip would sit on top of the modal. */}
      {hovered && !opened ? <EntryPopover hovered={hovered} /> : null}

      {opened ? (
        <AppointmentDialog
          entry={opened}
          staff={staff}
          timezone={timezone}
          onClose={() => setOpened(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}

      {adding ? (
        <BlockDialog
          days={days}
          staff={staff}
          initialDate={adding}
          timezone={timezone}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * A step through time that only touches the network when it has to.
 *
 * `onStep` is the in-memory move — the next day of the week already loaded —
 * and returns false when the step would leave that week. Only then does this
 * fall through to the link, which is a real navigation for data the browser
 * does not have. A week-view arrow always navigates, so it has no `onStep` and
 * stays a plain link, keeping middle-click and "open in new tab" working.
 */
function ArrowButton({
  href,
  label,
  onStep,
  children,
}: {
  href: string;
  label: string;
  onStep?: () => boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
    focusRing,
  );

  return (
    <Link
      href={href}
      aria-label={label}
      className={className}
      onClick={(event) => {
        if (!onStep) return;
        // Handled in memory — stop the navigation the href would otherwise do.
        if (onStep()) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}

/**
 * The mark a booking in a non-default state carries, and what it says.
 *
 * ---------------------------------------------------------------------------
 * **These replaced the coloured bar down the card's side.** The bar was the one
 * saturated thing on a card and it carried the status, but a 4px stripe is
 * hue alone, and hue alone never carries status in this product. Each state
 * now gets a drawn mark with a name — an hourglass for a request, a tick for a
 * finished booking, a crossed-out person for a no-show, a cross for a
 * cancellation — so it reads without colour and is announced to a screen
 * reader as the word.
 *
 * White glyphs on the 600 steps: amber-500 cannot hold a white mark at the 3:1
 * a graphic needs, amber-600 can. `confirmed` has no mark, because a mark on
 * every ordinary booking is wallpaper.
 * ---------------------------------------------------------------------------
 */
const STATUS_MARKS: Partial<
  Record<
    AppointmentStatusName,
    { Icon: LucideIcon; label: string; tone: string }
  >
> = {
  pending: {
    Icon: Hourglass,
    label: "ממתין לאישור",
    tone: "animate-pending bg-amber-600",
  },
  completed: { Icon: Check, label: "הושלם", tone: "bg-emerald-600" },
  no_show: { Icon: UserX, label: "לא הגיע", tone: "bg-zinc-500" },
  cancelled: { Icon: X, label: "בוטל", tone: "bg-rose-600" },
};

function StatusMark({
  status,
  size,
}: {
  status: string | null;
  /**
   * `dot` for the compact card, which has no width to spare for a glyph: a
   * point of the same colour in its corner, still named for a screen reader.
   */
  size: "sm" | "md" | "dot";
}) {
  const mark = status
    ? STATUS_MARKS[status as AppointmentStatusName]
    : undefined;
  if (!mark) return null;

  if (size === "dot") {
    return (
      <span
        role="img"
        aria-label={mark.label}
        className={cn(
          "absolute end-1 top-1 size-1.5 rounded-full ring-1 ring-white/80 dark:ring-zinc-950/70",
          mark.tone,
        )}
      />
    );
  }

  const { Icon } = mark;
  return (
    <span
      role="img"
      aria-label={mark.label}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-white shadow-sm",
        size === "md" ? "size-4" : "size-3.5",
        mark.tone,
      )}
    >
      <Icon
        className={size === "md" ? "size-2.5" : "size-2"}
        strokeWidth={3}
        aria-hidden
      />
    </span>
  );
}

/** "דנה" from "דנה אזולאי" — what the compact card has room for. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * How round a card is, by how much of itself it draws. Rounder where there is
 * room for the curve to read as glass, tighter where the card is a sliver and
 * a large radius would eat the corner of its own text.
 */
function cardRadius(dayView: boolean, card: CardMode): string {
  if (dayView) return "rounded-2xl";
  if (card === "full") return "rounded-xl";
  if (card === "chip") return "rounded-lg";
  return "rounded-md";
}

function EntryCard({
  entry,
  style,
  dayView,
  variant,
  card,
  minHeight,
  focused,
  onHoverChange,
  onOpen,
}: {
  entry: CalendarEntry;
  style: CSSProperties;
  /** One column instead of seven — the card can afford to be read, not scanned. */
  dayView: boolean;
  /**
   * This provider's texture index among everyone who picked the same colour.
   * `0` — the overwhelmingly common case — is the untouched solid dot.
   */
  variant: number;
  /**
   * How much of itself the card puts on screen — the chosen density's
   * `card` mode. See `lib/calendar-density.ts`.
   */
  card: CardMode;
  /**
   * The floor, already capped at the room before the next booking in this
   * lane: pixels from `cardHeightPx`, or the overview's CSS from
   * `blockMinHeight`. Applied as `min-height` so it only ever lifts a card that
   * would otherwise be too short to read.
   */
  minHeight: number | string;
  /** Arrived here from ליבי pointing at this one. */
  focused: boolean;
  onHoverChange: (hover: HoveredEntry | null) => void;
  onOpen: (entry: CalendarEntry) => void;
}) {
  const status = entry.kind === "appointment" ? entry.status : null;
  /**
   * A booking the owner has not answered yet.
   *
   * **Amber whether or not the shop runs "תורים באישור".** This used to be
   * gated on the shop's flag, on the reasoning that with approval off nothing
   * becomes `pending`. That stopped being true at 0029: a single service can
   * require approval inside a shop that does not, and its requests were drawn
   * as ordinary bookings — the one card on the grid waiting on the owner,
   * indistinguishable from the rest.
   */
  const pending = status === "pending";
  const cancelled = status === "cancelled";
  /** Not happening: cancelled, or the client never came. */
  const muted = cancelled || status === "no_show";

  const start = minutesToLabel(entry.startMinutes);
  const span = `${start}–${minutesToLabel(entry.endMinutes)}`;
  const statusLabel =
    status && status !== "confirmed" && status in STATUS_LABEL
      ? STATUS_LABEL[status as AppointmentStatusName]
      : null;
  /** What this card would say if it had room — the tooltip, and the label. */
  const description = [span, entry.title, entry.subtitle, statusLabel]
    .filter(Boolean)
    .join(" · ");
  /** Percentages position the card; the floor is laid on top of them. */
  const boxStyle: CSSProperties = { ...style, minHeight };

  /** What the client asked for on this booking. */
  const hasNote = Boolean(entry.notes?.trim());
  /** What the shop knows about this person, across every booking. */
  const hasClientNote = Boolean(entry.clientProfileNotes?.trim());

  /**
   * How many of name / time / service this booking has room for — see
   * `lineBudget`, which owns the arithmetic and is tested on its own. The hour
   * has already grown so every booking of ten minutes or more gets them all;
   * the budget is what keeps a shorter one honest.
   */
  const lines =
    card === "block" || typeof minHeight !== "number"
      ? 1
      : lineBudget(minHeight, dayView ? "day" : "week", card);

  /**
   * The note's text on the card, rather than only a mark saying there is one.
   *
   * Day view only, and only once the three lines above it are already paid for
   * and the booking still has room. In the week view the same line would be a
   * two-word fragment ending in an ellipsis, which is not the note — it is the
   * *illusion* of having read it.
   */
  const showNoteText =
    dayView &&
    hasNote &&
    typeof minHeight === "number" &&
    minHeight >= cardPxForLines(MAX_CARD_LINES + 1, "day");

  /**
   * The secondary lines' weight. Faded on a live card, where the name leads; at
   * full strength on a muted one, whose zinc text has no contrast to spare —
   * `calendar-glass-contrast.test.ts` measures it with no fade.
   */
  const quiet = muted ? undefined : "opacity-75";
  const row = dayView ? CARD_ROW_DAY : CARD_ROW_WEEK;

  const show = (event: React.MouseEvent | React.FocusEvent) => {
    onHoverChange({
      entry,
      rect: event.currentTarget.getBoundingClientRect(),
    });
  };

  const className = cn(
    "group absolute flex overflow-hidden text-start",
    cardRadius(dayView, card),
    "border backdrop-blur-sm",
    "focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-none dark:focus-visible:ring-zinc-100",
    "hover:z-10",
    // Type scales with the room available. Seven columns cannot afford
    // more than 10px; one column can, and shrinking it there would be
    // making the view smaller than the one it replaced. The line-height rides
    // inside the size class — see `CARD_TYPE_WEEK` for why it has to.
    dayView ? CARD_TYPE_DAY : CARD_TYPE_WEEK,
    entry.kind === "block"
      ? "cal-block text-zinc-700 dark:text-zinc-300"
      : cn(
          /**
           * **Glass in the tenant's own hue, and more of it in the day view.**
           *
           * `.cal-glass` mixes `var(--accent)` into a translucent fill in CSS
           * rather than here, because Tailwind cannot build a class from a
           * runtime colour and a `--cal-glass-bg` token on `:root` would bake in
           * the fallback — see the block in `globals.css`. The percentages, the
           * sheen and their dark variants live there too.
           *
           * The week view stays properly translucent so seven narrow columns do
           * not become a wall of colour and the open-hours band reads through.
           * The day view has one wide column with nothing to compete with, so it
           * spends the room on legibility instead: same hue, nearly opaque.
           */
          dayView ? "cal-glass-solid" : "cal-glass",
          muted
            ? "text-zinc-600 dark:text-zinc-400"
            : "text-zinc-900 dark:text-zinc-50",
          /**
           * **Whose booking this is, in the colour the legend uses.**
           *
           * `staffColor` is only populated for a team — see the page — so a
           * one-chair shop keeps the tenant's accent and the grid reads as the
           * shop's own. With a team, each card takes that person's hue through
           * `--cal-hue`, which is the same swatch as their dot in the key
           * directly above the grid.
           */
          entry.staffColor && staffSwatch(entry.staffColor).tint,
          /**
           * The collision step, on the card's own surface. Null for anybody
           * whose colour is theirs alone, so an ordinary team renders exactly
           * as it did — this only ever appears where there is something to
           * disambiguate.
           */
          staffToneClass(variant),
          /**
           * Last, so they win the fill from the staff tint above — see
           * `.cal-pending` and `.cal-muted`. What has to happen, or that
           * nothing will, outranks whose booking it is.
           */
          pending && "cal-pending",
          muted && "cal-muted",
          cancelled && "cal-cancelled",
        ),
    /**
     * **The one ליבי was asked to point at.**
     *
     * A ring and a lift rather than a colour: every hue on this grid already
     * means something — the provider, a pending request, a cancellation — and
     * spending one on "you arrived here looking for this" would collide with
     * all three. The ring sits outside the card, so it reads over the glass
     * whatever is mixed into it.
     */
    focused &&
      "z-20 ring-2 ring-violet-500 ring-offset-1 ring-offset-white shadow-lg dark:ring-violet-400 dark:ring-offset-zinc-950",
  );

  /**
   * The footnotes: what was written, and whether ליבי booked it.
   *
   * The note marks go in `full` only. A 42px column has room for a first name
   * or for two 12px badges, not both — and a name cut to two characters to make
   * space for a mark saying "there is more to read" has itself become the thing
   * there is more to read.
   *
   * **ליבי's mark survives `compact` where the notes do not.** It answers a
   * different question — *did that spoken sentence actually become a booking* —
   * on the newest way into this calendar, the one an owner is still learning to
   * trust.
   */
  const footnotes = (
    <>
      {card === "full" && hasNote ? <NoteMark kind="appointment" /> : null}
      {card === "full" && hasClientNote ? <NoteMark kind="client" /> : null}
      {marksTheCard(entry.origin) ? (
        <Mic
          className="size-3 shrink-0 text-violet-600 dark:text-violet-400"
          aria-label="נקבע על ידי ליבי"
        />
      ) : null}
    </>
  );

  const body =
    card === "block" ? (
      /**
       * **The overview draws one thing: when.**
       *
       * The card's position already says roughly where in the day a booking
       * sits; the badge is the refinement — "half past", not "about half past" —
       * and it sits on a chip of its own glass so it reads on every tint. A
       * finished booking adds its tick, the one status a colour could not
       * already say. The name and the rest are one tap away.
       */
      <span
        className={cn(
          // 9px tall on a phone, flush to the card's top edge: a quarter hour
          // there is 11px of card, and a 10px badge with a margin ran past the
          // bottom border. From `sm` up the hour is taller and the badge
          // gets its margin and a larger type back.
          "cal-time-pill flex h-[9px] shrink-0 items-center gap-0.5 self-start rounded-full px-1 text-[8px]/[9px] font-semibold tabular-nums sm:m-px sm:h-3 sm:text-[9px]/[12px]",
          cancelled && "line-through",
        )}
      >
        {status === "completed" ? (
          <Check className="size-2 shrink-0" strokeWidth={3} aria-hidden />
        ) : null}
        {start}
      </span>
    ) : (
      /**
       * **A column, one field per line.**
       *
       * Name, then time, then service — each on its own row, each either shown
       * whole or not shown at all. `lineBudget` decides how many the booking's
       * height carries, and the hour has grown so that is all of them from ten
       * minutes up; below that, what is dropped is the least important field
       * rather than the end of every field.
       *
       * `justify-center` so a one-line card sits in the middle of its block
       * instead of clinging to the top edge.
       */
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center overflow-hidden",
          dayView ? "px-3" : card === "chip" ? "px-1" : "px-2",
          CARD_PAD[dayView ? "day" : "week"][
            card === "chip" || lines <= 1 ? "tight" : "roomy"
          ],
        )}
      >
        <div className={cn("flex shrink-0 items-center gap-1", row)}>
          {/* Whose booking, on a team: the legend's own dot, texture and all,
              where the side bar used to carry it. Keyed on `staffName`, which
              the page sets only for a team — `staffColor` is set for a one-chair
              shop too, and a dot on every card of a shop with one provider says
              nothing. */}
          {card === "full" && entry.staffName && entry.staffColor ? (
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                staffSwatch(entry.staffColor).dot,
                staffVariantClass(variant),
              )}
            />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-bold",
              cancelled && "line-through",
            )}
          >
            {card === "chip" ? firstName(entry.title) : entry.title}
          </span>
          {card === "chip" && lines <= 1 ? (
            <span className={cn("shrink-0 tabular-nums", quiet)}>{start}</span>
          ) : null}
          {card === "full" ? (
            <StatusMark status={status} size={dayView ? "md" : "sm"} />
          ) : null}
        </div>

        {/**
         * **`chip` is a first name and a start time, on every booking.** The
         * service in a 42px column is three characters and an ellipsis, which
         * reads as damage rather than as information; the time survives because
         * it is the one field the card's position only approximates.
         */}
        {card === "chip" ? (
          lines >= 2 ? (
            <div className={cn("flex shrink-0 items-center gap-0.5", row)}>
              <span className={cn("min-w-0 truncate tabular-nums", quiet)}>
                {start}
              </span>
              {footnotes}
            </div>
          ) : null
        ) : lines >= 3 ? (
          <>
            <div className={cn("flex shrink-0 items-center gap-1", row)}>
              <span
                className={cn("min-w-0 flex-1 truncate tabular-nums", quiet)}
              >
                {span}
              </span>
              {footnotes}
            </div>
            {entry.subtitle ? (
              <span className={cn("shrink-0 truncate", quiet)}>
                {entry.subtitle}
              </span>
            ) : null}
          </>
        ) : lines === 2 ? (
          // Shorter than the hour was grown for: the service joins the time
          // rather than being dropped.
          <div className={cn("flex shrink-0 items-center gap-1", row)}>
            <span className={cn("min-w-0 flex-1 truncate", quiet)}>
              <span className="tabular-nums">{start}</span>
              {entry.subtitle ? ` · ${entry.subtitle}` : ""}
            </span>
            {footnotes}
          </div>
        ) : null}

        {/* The note itself, where there is genuinely room for it: one wide
            column and a booking long enough that a fourth line does not crowd
            out the three above. Everywhere else the mark says *look* and the
            dialog is where it is read. */}
        {showNoteText ? (
          <span className="shrink-0 truncate text-[11px]/5 opacity-70">
            {entry.notes}
          </span>
        ) : null}

        {card === "chip" ? <StatusMark status={status} size="dot" /> : null}
      </div>
    );

  // A block is not an appointment and has nothing to open — it is removed from
  // the list below the grid. Rendering it as a button would announce an action
  // that does not exist.
  if (entry.kind === "block") {
    return (
      <div
        style={boxStyle}
        tabIndex={0}
        id={`entry-${entry.appointmentId}`}
        title={description}
        onMouseEnter={show}
        onFocus={show}
        onMouseLeave={() => onHoverChange(null)}
        onBlur={() => onHoverChange(null)}
        className={className}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      style={boxStyle}
      id={`entry-${entry.appointmentId}`}
      aria-haspopup="dialog"
      /**
       * **The overview card shows only a time, so it needs a name.**
       *
       * `title` supplies one as a last resort, and a last resort is the wrong
       * place for the only name a control has. Given explicitly here, and only
       * where the visible content is a fragment — on a card that shows its
       * client's name, an `aria-label` would replace what a voice-control user
       * can see and say with something longer that they cannot.
       */
      aria-label={card === "block" ? description : undefined}
      // The native tooltip stays as the no-JavaScript, no-pointer fallback —
      // the rich card below is an enhancement, not the only way to read this.
      title={description}
      onClick={() => onOpen(entry)}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onHoverChange(null)}
      onBlur={() => onHoverChange(null)}
      className={cn(className, "cursor-pointer")}
    >
      {body}
    </button>
  );
}

/**
 * "There is something written here" — and *which* something.
 *
 * ---------------------------------------------------------------------------
 * The two notes on an appointment answer different questions and must not look
 * alike. A **document** is what this client typed when booking *this* time
 * ("I'm bringing my son"); a **person** is what the shop has recorded about them
 * across every visit ("always late, prefers the window chair"). One is a request
 * to act on today, the other is standing context — and an owner who reads the
 * second as the first ends up acting on something nobody asked for.
 *
 * `role="img"` with a label rather than `aria-hidden`: on a card this small the
 * mark is the *only* sign a booking carries a note, so hiding it from a screen
 * reader would hide the note itself. `NotesBadge` says the same thing in words
 * where there is room for words.
 * ---------------------------------------------------------------------------
 */
function NoteMark({ kind }: { kind: "appointment" | "client" }) {
  const Icon = kind === "appointment" ? FileText : UserRound;

  return (
    <Icon
      role="img"
      aria-label={kind === "appointment" ? "הערה לתור" : "הערות על הלקוח"}
      className="size-3 shrink-0 opacity-70"
    />
  );
}

type HoveredEntry = { entry: CalendarEntry; rect: DOMRect };

/**
 * The hover card.
 *
 * **Rendered at the calendar root and positioned `fixed`, not inside the card
 * it describes.** The grid lives in an `overflow-x-auto` container, and CSS
 * computes the other axis to `auto` alongside it — so an absolutely-positioned
 * popover inside a day column is clipped on all four sides. `fixed` escapes
 * that, and keeping it out of the card matters for a second reason: the cards
 * carry `backdrop-blur`, which establishes a containing block and would pin a
 * fixed descendant right back inside the thing it is trying to escape.
 *
 * `role="tooltip"` rather than a dialog: it is supplementary detail about the
 * element under the cursor, it takes no focus, and everything in it is also
 * reachable from the agenda. The trigger keeps its `title` so the same summary
 * survives without a pointer.
 */
function EntryPopover({ hovered }: { hovered: HoveredEntry }) {
  const { entry, rect } = hovered;
  const CARD_WIDTH = 256;

  // Clamped to the viewport, because a card on the last column would otherwise
  // open past the right edge and a card near the bottom past the fold.
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - CARD_WIDTH / 2),
    Math.max(8, window.innerWidth - CARD_WIDTH - 8),
  );
  const opensUpward = rect.bottom + 220 > window.innerHeight;

  // One shared rule. The inline strip-and-swap this replaces mishandled a
  // `00972…` number — it saw the leading zero as a trunk code and produced
  // `9720972…`, a chat with nobody. See `whatsappHref`.
  const wa = whatsappHref(entry.clientPhone);

  /** The card's own colour on the glass edge — the same rule as the sheet. */
  const hueClass =
    entry.status === "pending"
      ? "glass-hue-pending"
      : entry.staffColor
        ? staffSwatch(entry.staffColor).tint
        : undefined;

  return (
    <div
      role="tooltip"
      style={{
        position: "fixed",
        width: CARD_WIDTH,
        insetInlineStart: "auto",
        left,
        ...(opensUpward
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      }}
      className={cn(
        "glass-float animate-fade pointer-events-none z-50 rounded-2xl p-3.5",
        hueClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-50">
            {entry.title}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-zinc-700 tabular-nums dark:text-zinc-300">
            {minutesToLabel(entry.startMinutes)}–
            {minutesToLabel(entry.endMinutes)}
          </p>
        </div>
        {entry.status ? <StatusChip status={entry.status} /> : null}
      </div>

      {/* The facts as icons with values — the appointment sheet's own line, so
          hovering a card and opening it read as the same object at two sizes. */}
      <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-zinc-800 dark:text-zinc-200">
        {entry.subtitle ? (
          <PopoverFact icon={Scissors} label="שירות">
            {entry.subtitle}
          </PopoverFact>
        ) : null}
        {entry.priceCents !== null ? (
          <PopoverFact icon={Tag} label="מחיר">
            <span className="tabular-nums">
              {formatPrice(entry.priceCents)}
            </span>
          </PopoverFact>
        ) : null}
        {entry.staffName ? (
          <PopoverFact icon={UserRound} label="נותן שירות">
            {entry.staffName}
          </PopoverFact>
        ) : null}
        {entry.clientPhone ? (
          <PopoverFact icon={Phone} label="טלפון">
            <span dir="ltr" className="tabular-nums">
              {entry.clientPhone}
            </span>
          </PopoverFact>
        ) : null}
      </ul>

      {entry.notes ? (
        <div className="mt-2">
          <NotesBadge notes={entry.notes} />
        </div>
      ) : null}

      {/* The card can only carry a mark. This is the one place with room to say
          what the mark means and what to do about it — and the dialog behind a
          click opens with exactly those two buttons. */}
      {entry.status === "pending" ? (
        <p className="mt-2.5 rounded-xl bg-amber-50/90 px-2.5 py-1.5 text-[11px] leading-relaxed font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          ממתין לאישורכם — לחיצה על התור פותחת אישור או דחייה.
        </p>
      ) : null}

      {/* The mark says *look*; this is the thing to look at. The hover card is
          the one place on the calendar with room for a sentence.

          Both notes are labelled with the same icons the card's marks use — a
          document for what was asked today, a person for what the shop knows
          about them — so the mark and its explanation are visibly the same
          thing. */}
      {entry.notes?.trim() ? (
        <div className="glass-inset mt-2.5 rounded-xl px-2.5 py-2">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
            <FileText className="size-3" aria-hidden />
            הערה לתור הזה
          </p>
          <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            {entry.notes}
          </p>
        </div>
      ) : null}

      {/* Labelled and tinted differently from the booking note above, because
          the two answer different questions and an owner glancing at this card
          has to be able to tell "they asked for X today" from "this is how they
          always are". */}
      {entry.clientProfileNotes?.trim() ? (
        <div className="mt-2.5 rounded-xl bg-amber-50/90 px-2.5 py-2 dark:bg-amber-950/50">
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
            <UserRound className="size-3" aria-hidden />
            הערות קבועות על הלקוח
          </p>
          <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-100">
            {entry.clientProfileNotes}
          </p>
        </div>
      ) : null}

      {/* `pointer-events-auto` on the links only: the card itself must stay
          transparent to the pointer, or moving toward it would leave the
          trigger and close it before the cursor arrived. */}
      {entry.clientPhone ? (
        <div className="pointer-events-auto mt-3 flex gap-1.5">
          <a
            href={`tel:${entry.clientPhone}`}
            className={cn(
              "glass-control inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-zinc-800 dark:text-zinc-200",
              focusRing,
            )}
          >
            <Phone className="size-3.5" aria-hidden />
            חיוג
          </a>
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "glass-control inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[11px] font-semibold text-zinc-800 dark:text-zinc-200",
                focusRing,
              )}
            >
              <MessageCircle className="size-3.5" aria-hidden />
              וואטסאפ
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One fact on the hover card: an icon, a value, and its name for a screen reader. */
function PopoverFact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-1">
      <Icon
        className="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400"
        aria-hidden
      />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

/**
 * Adding a block.
 *
 * Writes a `time_off` row through the action the staff page already uses, so
 * there is one implementation of "block this time" and one place where the
 * cross-tenant check lives.
 */
function BlockDialog({
  days,
  staff,
  initialDate,
  timezone,
  onClose,
}: {
  days: CalendarDay[];
  staff: { id: string; name: string; color: string }[];
  initialDate: string;
  timezone: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    staffId: "",
    date: initialDate,
    startTime: "12:00",
    endTime: "13:00",
    reason: "",
  });

  function save() {
    startTransition(async () => {
      const result: StaffActionResult = await createStaffTimeOffAction(form);
      if (result.ok) {
        toast(result.message ?? "החסימה נשמרה", "success");
        onClose();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-dialog-title"
        className="animate-sheet relative w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl sm:pb-5 dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="block-dialog-title"
              className="text-base font-bold text-zinc-900 dark:text-zinc-100"
            >
              חסימה ביומן
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              הזמן הזה ייחסם גם לקביעת תורים מהעמוד הציבורי.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="-me-1 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              מה זה
            </span>
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="הפסקה, סידורים, תחזוקה…"
              className={inputClass}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              על מי חל
            </span>
            <select
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
              className={inputClass}
            >
              <option value="">כל העסק</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                תאריך
              </span>
              <select
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={cn(inputClass, "text-xs")}
              >
                {days.map((day) => (
                  <option key={day.date} value={day.date}>
                    {WEEKDAY_SHORT[day.weekday]} · {day.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                משעה
              </span>
              <input
                type="time"
                dir="ltr"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value })
                }
                className={cn(inputClass, "text-xs")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                עד שעה
              </span>
              <input
                type="time"
                dir="ltr"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className={cn(inputClass, "text-xs")}
              />
            </label>
          </div>

          <p className="text-[11px] text-zinc-500">
            השעות לפי אזור הזמן של העסק ({timezone}).
          </p>
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={save}
          className={cn(btnPrimary, "mt-4 h-11 w-full")}
        >
          שמירת החסימה
        </button>
      </div>
    </div>
  );
}

/** The blocks in view, listed below the grid so they can be removed. */
export function BlockList({ blocks }: { blocks: CalendarEntry[] }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (blocks.length === 0) return null;

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteStaffTimeOffAction(id);
      if (result.ok) toast(result.message ?? "החסימה הוסרה", "success");
      else toast(result.error, "error");
    });
  }

  // Deduped by time_off id: a multi-day block draws once per day but is one row.
  const unique = [...new Map(blocks.map((b) => [b.timeOffId, b])).values()];

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        חסימות בשבוע הזה
      </h2>
      <ul
        className={cn(
          cardClass,
          "divide-y divide-zinc-200 dark:divide-zinc-800",
        )}
      >
        {unique.map((block) => (
          <li
            key={block.timeOffId}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {block.title}
              </span>
              <span className="block text-xs text-zinc-500">
                {block.subtitle}
              </span>
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => block.timeOffId && remove(block.timeOffId)}
              aria-label="הסרת החסימה"
              className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
