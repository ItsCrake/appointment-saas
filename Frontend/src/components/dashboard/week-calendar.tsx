"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Phone,
  Trash2,
  X,
} from "lucide-react";

import {
  createStaffTimeOffAction,
  deleteStaffTimeOffAction,
  type StaffActionResult,
} from "@/app/dashboard/staff/actions";
import { useToast } from "@/components/ui/toast";
import {
  assignLanes,
  gridBounds,
  hourRows,
  minutesToLabel,
  placeItem,
  type CalendarItem,
} from "@/lib/calendar-layout";
import { formatPrice } from "@/lib/format";
import { staffSwatch } from "@/lib/staff-colors";
import { cn } from "@/lib/utils";

import {
  btnPrimary,
  btnSecondary,
  cardClass,
  inputClass,
  NotesBadge,
  StatusChip,
} from "./ui";

const WEEKDAY_SHORT = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export type CalendarEntry = CalendarItem & {
  kind: "appointment" | "block";
  /** Client name for an appointment; the reason for a block. */
  title: string;
  /** Service name for an appointment; who and when for a block. */
  subtitle: string | null;
  /** Appointments only — powers the call and WhatsApp links in the hover card. */
  clientPhone: string | null;
  /** What the client typed when booking. Null when they typed nothing. */
  notes: string | null;
  status: string | null;
  priceCents: number | null;
  staffName: string | null;
  staffColor: string | null;
  /** Present for blocks, so they can be removed from here. */
  timeOffId: string | null;
};

/**
 * One hour of grid, in both the rail and every day column.
 *
 * A shared constant because the two are separate elements that must agree
 * exactly: a difference of a single step shears the whole week, and the times
 * on the left stop describing the cards on the right.
 *
 * `h-20` rather than the original `h-14`. At 56px an hour, a 15-minute booking
 * was 14 pixels tall — less than one line of the smallest type on the page, so
 * it could only ever render as a clipped fragment of a name. At 80px it is 20,
 * which fits the single-row layout below with its padding.
 */
const HOUR_ROW_WEEK = "h-20";

/**
 * The day view spends its extra room vertically as well as horizontally.
 *
 * At 112px an hour a 15-minute booking is 28 pixels — enough for the two-line
 * layout, so the day view never has to fall back to the compact row and every
 * card on it reads at full size. That is the point of having the view at all.
 */
const HOUR_ROW_DAY = "h-28";

/** Below this, a card gets one row instead of two. */
const COMPACT_BELOW_MIN = 30;

/** Same threshold in pixels, since the day view's rows are taller. */
const COMPACT_BELOW_MIN_DAY = 15;

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
}) {
  const [adding, setAdding] = useState<string | null>(null);
  // One at a time, held at the root so the card can be positioned `fixed` and
  // escape the grid's scroll clipping. See `EntryPopover`.
  const [hovered, setHovered] = useState<HoveredEntry | null>(null);

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

  const dayView = view === "day";
  const hourRow = dayView ? HOUR_ROW_DAY : HOUR_ROW_WEEK;

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
      ),
    [visibleEntries, days],
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
            className={cn(btnSecondary, "h-9 px-4 text-xs")}
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

        {/* Buttons, not links: the whole week is already loaded, so switching
            view is a state change rather than a navigation. */}
        <div
          role="group"
          aria-label="תצוגת יומן"
          className="flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-800"
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
                view === value
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
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
              <span
                aria-hidden
                className={cn(
                  "size-2.5 rounded-full",
                  staffSwatch(member.color).dot,
                )}
              />
              {member.name}
            </li>
          ))}
        </ul>
      ) : null}

      {/* One scroll container: the seven columns keep a usable width on a phone
          by scrolling sideways rather than compressing to nothing. */}
      <div className={cn(cardClass, "overflow-x-auto")}>
        {/* Seven columns need a floor or they compress to nothing on a phone.
            One column does not — a day view that scrolled sideways would be
            hiding the very space it exists to give the cards. */}
        <div className={dayView ? "" : "min-w-[46rem]"}>
          <div
            className="grid border-b border-zinc-200 dark:border-zinc-800"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div />
            {days.map((day) => (
              <div
                key={day.date}
                className={cn(
                  "px-1 py-2 text-center",
                  day.isToday && "bg-(--accent-soft)",
                )}
              >
                <p className="text-[11px] text-zinc-500">
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

          <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
            {/* Hour rail */}
            <div>
              {rows.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    hourRow,
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
                    className={cn(
                      hourRow,
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
                  const box = placeItem(entry, bounds);
                  return (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      dayView={dayView}
                      onHoverChange={setHovered}
                      style={{
                        top: `${box.top}%`,
                        height: `${box.height}%`,
                        insetInlineStart: `${box.inlineStart}%`,
                        width: `${box.width}%`,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hovered ? <EntryPopover hovered={hovered} /> : null}

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
  const className =
    "flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100";

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
 * The colour of a card's accent bar.
 *
 * **Staff colour wins when there is one**, because a team shop renders a staff
 * legend directly above this grid — a bar in any other colour would contradict
 * the key the owner is reading it against. `staffName`/`staffColor` are only
 * populated for a team, so a one-chair shop has no legend and the bar is free
 * to carry the thing that actually varies there: the status.
 *
 * Blocks get zinc. A block is the absence of availability and must not compete
 * with a real booking for attention.
 */
function accentBar(entry: CalendarEntry): string {
  if (entry.kind === "block") return "bg-zinc-400 dark:bg-zinc-600";
  if (entry.staffColor) return staffSwatch(entry.staffColor).dot;

  switch (entry.status) {
    case "pending":
      return "bg-amber-500";
    case "cancelled":
      return "bg-rose-500";
    case "no_show":
      return "bg-zinc-400";
    case "completed":
      return "bg-emerald-500";
    default:
      return "bg-indigo-500";
  }
}

function EntryCard({
  entry,
  style,
  dayView,
  onHoverChange,
}: {
  entry: CalendarEntry;
  style: React.CSSProperties;
  /** One column instead of seven — the card can afford to be read, not scanned. */
  dayView: boolean;
  onHoverChange: (hover: HoveredEntry | null) => void;
}) {
  const cancelled = entry.status === "cancelled" || entry.status === "no_show";
  const span = `${minutesToLabel(entry.startMinutes)}–${minutesToLabel(entry.endMinutes)}`;

  /**
   * One row or two, decided by how much room the booking actually has.
   *
   * A 15-minute slot is 20px tall. Stacking a name over a time in there
   * produced two clipped half-lines and an ellipsis on both — technically more
   * information, legibly less. One row that reads
   * "09:00 · דני · תספורת" and truncates only at the end is the same data in
   * the order somebody scanning a week actually wants it.
   */
  const compact =
    entry.endMinutes - entry.startMinutes <
    (dayView ? COMPACT_BELOW_MIN_DAY : COMPACT_BELOW_MIN);

  const show = (event: React.MouseEvent | React.FocusEvent) => {
    onHoverChange({
      entry,
      rect: event.currentTarget.getBoundingClientRect(),
    });
  };

  return (
    <div
      style={style}
      tabIndex={0}
      // The native tooltip stays as the no-JavaScript, no-pointer fallback —
      // the rich card below is an enhancement, not the only way to read this.
      title={`${span} · ${entry.title}${entry.subtitle ? ` · ${entry.subtitle}` : ""}`}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onHoverChange(null)}
      onBlur={() => onHoverChange(null)}
      className={cn(
        "group absolute flex overflow-hidden rounded-lg text-[10px] leading-tight",
        "ring-1 backdrop-blur-sm transition-shadow",
        "focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-none dark:focus-visible:ring-zinc-100",
        "hover:z-10 hover:shadow-lg",
        // Type scales with the room available. Seven columns cannot afford
        // more than 10px; one column can, and shrinking it there would be
        // making the view smaller than the one it replaced.
        dayView ? "text-xs sm:text-sm" : "text-[10px]",
        entry.kind === "block"
          ? dayView
            ? "bg-zinc-200 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700"
            : "bg-zinc-100/70 text-zinc-600 ring-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700"
          : cn(
              // **Solid in the day view, translucent in the week.** Across
              // seven narrow columns a solid fill is a wall of colour, so the
              // card lets the open-hours band read through it. One wide column
              // is the opposite problem: there is nothing to compete with, and
              // a washed card on a pale band is harder to read than a plain
              // white one.
              dayView
                ? "bg-white text-zinc-900 shadow-sm ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-50 dark:ring-zinc-700"
                : cn(
                    "bg-white/75 text-zinc-900 ring-zinc-200/80",
                    "dark:bg-zinc-900/70 dark:text-zinc-50 dark:ring-zinc-700/80",
                  ),
              cancelled && "opacity-55",
            ),
      )}
    >
      {/* The bar is the only saturated thing on the card, which is what lets it
          carry meaning at a glance across seven columns. */}
      <span
        aria-hidden
        className={cn(
          "shrink-0 rounded-s-lg",
          dayView ? "w-1.5" : "w-1",
          accentBar(entry),
        )}
      />

      <div
        className={cn("min-w-0 flex-1", dayView ? "px-3 py-2" : "px-1.5 py-1")}
      >
        {compact ? (
          <div className="flex items-baseline gap-1 overflow-hidden whitespace-nowrap">
            <span className="shrink-0 font-semibold tabular-nums">
              {minutesToLabel(entry.startMinutes)}
            </span>
            <span className={cn("truncate", cancelled && "line-through")}>
              {entry.title}
              {entry.subtitle ? ` · ${entry.subtitle}` : ""}
            </span>
          </div>
        ) : (
          <>
            <p
              className={cn("truncate font-bold", cancelled && "line-through")}
            >
              {entry.title}
            </p>
            <p className="truncate opacity-75">
              <span className="tabular-nums">{span}</span>
              {entry.subtitle ? ` · ${entry.subtitle}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
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
  const CARD_WIDTH = 240;

  // Clamped to the viewport, because a card on the last column would otherwise
  // open past the right edge and a card near the bottom past the fold.
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - CARD_WIDTH / 2),
    Math.max(8, window.innerWidth - CARD_WIDTH - 8),
  );
  const opensUpward = rect.bottom + 200 > window.innerHeight;

  const phone = entry.clientPhone?.replace(/\D/g, "");
  const wa = phone?.startsWith("0") ? `972${phone.slice(1)}` : phone;

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
      className="animate-fade pointer-events-none z-50 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-900/95"
    >
      <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
        {entry.title}
      </p>

      <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">
        {minutesToLabel(entry.startMinutes)}–{minutesToLabel(entry.endMinutes)}
      </p>

      <dl className="mt-2 space-y-1 text-xs">
        {entry.subtitle ? <Row label="שירות">{entry.subtitle}</Row> : null}
        {entry.priceCents !== null ? (
          <Row label="מחיר">{formatPrice(entry.priceCents)}</Row>
        ) : null}
        {entry.staffName ? (
          <Row label="נותן שירות">{entry.staffName}</Row>
        ) : null}
        {entry.clientPhone ? (
          <Row label="טלפון">
            <span dir="ltr">{entry.clientPhone}</span>
          </Row>
        ) : null}
      </dl>

      {entry.status || entry.notes ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entry.status ? <StatusChip status={entry.status} /> : null}
          <NotesBadge notes={entry.notes} />
        </div>
      ) : null}

      {/* The badge says *look*; this is the thing to look at. The hover card is
          the one place on the calendar with room for a sentence. */}
      {entry.notes?.trim() ? (
        <p className="mt-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {entry.notes}
        </p>
      ) : null}

      {/* `pointer-events-auto` on the links only: the card itself must stay
          transparent to the pointer, or moving toward it would leave the
          trigger and close it before the cursor arrived. */}
      {entry.clientPhone ? (
        <div className="pointer-events-auto mt-2 flex gap-1.5">
          <a
            href={`tel:${entry.clientPhone}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-50"
          >
            <Phone className="size-3.5" aria-hidden />
            חיוג
          </a>
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-[11px] font-semibold text-zinc-700 transition-colors hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-100 dark:hover:text-zinc-50"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            וואטסאפ
          </a>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
    </div>
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
