"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileText,
  FoldVertical,
  Grid2x2,
  Hourglass,
  Loader2,
  MessageCircle,
  Mic,
  Move,
  Phone,
  Rows3,
  Scissors,
  Tag,
  Trash2,
  TriangleAlert,
  UserRound,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  previewSwapAction,
  rescheduleAppointmentAction,
  swapAppointmentsAction,
} from "@/app/dashboard/actions";
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
  type GridBounds,
} from "@/lib/calendar-layout";
import {
  FOCUS_RING_MS,
  CALENDAR_DENSITIES,
  chooseDensity,
  chooseFitHours,
  DAY_HEADER_ROW,
  densityServerSnapshot,
  densitySnapshot,
  DENSITY,
  fitHoursServerSnapshot,
  fitHoursSnapshot,
  subscribeDensity,
  subscribeFitHours,
  SUMMARY_HOUR_ROW,
  type CalendarDensity,
} from "@/lib/calendar-density";
import type { SwapPreview } from "@/lib/appointment-swap";
import {
  canMove,
  dropConflict,
  dropStart,
  minutesAt,
  movedEntry,
  SNAP_MINUTES,
  timeToMinutes,
  type DropConflict,
  type EntryMove,
} from "@/lib/calendar-edit";
import type { CalendarWeekData } from "@/lib/calendar-week-data";
import { dayLabel, shiftDays, weekOf } from "@/lib/calendar-week";
import { formatPrice, weekdayLabel } from "@/lib/format";
import { createRangeCache, fetchDashboardJson } from "@/lib/range-cache";
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

/** The crop toggle's name — its accessible label and its tooltip. */
const FIT_HOURS_LABEL = "הצגת השעות עם תורים בלבד";

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

/**
 * Every week this tab has drawn, keyed by tenant and week — see
 * `range-cache`. Module scope so it outlives the component: leaving the
 * calendar for the agenda and coming back finds the weeks already there.
 */
const weekCache = createRangeCache<CalendarWeekData>((key) =>
  fetchDashboardJson<CalendarWeekData>(
    `/api/dashboard/week?week=${encodeURIComponent(key.split("|")[1] ?? "")}`,
  ),
);

/**
 * How old a week may be and still be shown without asking again.
 *
 * Ten seconds when the owner steps onto it — a week they look at is refreshed
 * behind them unless it was fetched a moment ago — and a minute for a prefetch,
 * which is a guess about where they go next and should not keep the server
 * busy with weeks nobody is looking at. The delay lets the week on screen
 * finish drawing before its neighbours are asked for.
 */
const SHOWN_MAX_AGE_MS = 10_000;
const PREFETCH_MAX_AGE_MS = 60_000;
const PREFETCH_DELAY_MS = 250;

/**
 * The week the owner stepped onto, before its bookings have arrived.
 *
 * **The optimistic half of stepping.** The dates, the column heads and the
 * shop's hours are known without asking anybody — the hours are the same every
 * week — so the grid moves the moment the arrow is pressed and only the cards
 * wait. A week drawn from memory never needs this.
 */
function placeholderWeek(
  weekStart: string,
  reference: CalendarWeekData,
  today: string,
): CalendarWeekData {
  return {
    weekStart,
    days: weekOf(weekStart).map((date) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        label: dayLabel(date),
        weekday,
        isToday: date === today,
        open: reference.days.find((day) => day.weekday === weekday)?.open ?? [],
      };
    }),
    entries: [],
  };
}

/**
 * A move shown before the server has answered — see `useOptimistic` in
 * `WeekCalendar`. A swap moves the provider with the slot, so it carries the
 * other card's provider; a drag never changes who holds the booking.
 */
type OptimisticMove = EntryMove & {
  staff?: Pick<CalendarEntry, "staffId" | "staffName" | "staffColor">;
};
type MoveMap = Readonly<Record<string, OptimisticMove>>;
const NO_MOVES: MoveMap = {};

/** Where a picked-up booking would land, and what is in the way — the ghost. */
type DragView = {
  entryId: string;
  appointmentId: string;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  conflict: DropConflict | null;
  via: "pointer" | "keyboard";
};

/** A pointer drag in progress: handler state, never rendered. */
type DragSession = {
  entry: CalendarEntry;
  pointerId: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  /** Minutes between the card's start and the point it was picked up by. */
  grabOffset: number;
  /** Past the threshold — a drag rather than a tap. */
  active: boolean;
  raf: number;
  detach: () => void;
};

/** What a card calls in edit mode. One stable object, or null outside it. */
type EditHandlers = {
  pointerDown: (entry: CalendarEntry, event: React.PointerEvent<HTMLElement>) => void;
  keyDown: (entry: CalendarEntry, event: React.KeyboardEvent<HTMLElement>) => void;
  blur: (entry: CalendarEntry) => void;
};

/**
 * How far a press travels before it is a drag rather than a tap. A tap picks
 * the card for a swap, so a thumb that wobbles must not move a client.
 */
const DRAG_THRESHOLD_PX = 6;
/** How close to the frame's edge a drag starts scrolling it, and how fast. */
const EDGE_PX = 44;
const EDGE_SPEED_PX = 14;
/** The pinned day header — the top edge zone starts below it. */
const DAY_HEADER_PX = 48;

function noHover() {}

/**
 * The day column under a point, or the nearest one — the drag's hit test.
 *
 * Measured when the pointer moves, not when the grid renders: the grid itself
 * still measures nothing (see `WeekCalendar`), and a drag is the one moment
 * the question "where on screen is 10:35 on Tuesday" genuinely has to be
 * asked of the browser. The column's own drawn height makes it right at every
 * density, the overview included.
 */
function columnAt(grid: HTMLElement, x: number, y: number) {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const column of grid.querySelectorAll<HTMLElement>("[data-day-column]")) {
    const rect = column.getBoundingClientRect();
    const distance =
      x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const rect = best.getBoundingClientRect();
  return {
    dayIndex: Number(best.dataset.dayColumn),
    offsetY: y - rect.top,
    height: rect.height,
  };
}

/** A short shake on a card whose move was refused. Still for reduced motion. */
function refuse(appointmentId: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.getElementById(`entry-${appointmentId}`)?.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(-2px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 320, easing: "ease-out" },
  );
}

/** "ליום שלישי, 10:35" or "ל-10:35" — the day only when it changed. */
function landingPhrase(from: string, to: { date: string; time: string }) {
  return from === to.date
    ? `ל-${to.time}`
    : `ליום ${weekdayLabel(to.date)}, ${to.time}`;
}

export function WeekCalendar({
  initialView,
  initialDate,
  days: serverDays,
  entries: serverEntries,
  weekStart: serverWeekStart,
  thisWeek,
  staff,
  timezone,
  scope,
  focusAppointmentId,
}: {
  initialView: CalendarView;
  /** The focused day, "YYYY-MM-DD". Only meaningful in the day view. */
  initialDate: string;
  /**
   * The week the server rendered — the one in the address bar. Always the full
   * week, whichever view is showing. Every other week is fetched by the
   * component itself: see `weekCache`.
   */
  days: CalendarDay[];
  entries: CalendarEntry[];
  weekStart: string;
  /** Today in the shop's zone. */
  thisWeek: string;
  staff: { id: string; name: string; color: string }[];
  timezone: string;
  /**
   * Whose weeks these are — the tenant's id — so the cache never shows one
   * shop's week to another. An administrator can support two shops in one
   * tab; the key is what keeps their calendars apart.
   */
  scope: string;
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
   * **The week on screen is client state too, now.** Stepping a week used to
   * be a navigation — a server render of the whole route behind a skeleton,
   * 2.1–2.2s measured — for data one small query could answer. The week the
   * server rendered seeds the cache; every other week comes from
   * `/api/dashboard/week`, is drawn from memory when it was seen or prefetched,
   * and is refreshed behind the owner when it is old. See `range-cache`.
   */
  const [shownWeek, setShownWeek] = useState(serverWeekStart);

  /**
   * **A navigation wins over whatever the owner had stepped to** — ליבי's
   * "תראי לי", the dock, the address bar.
   *
   * Detected on the URL rather than the server's props: every step here
   * writes the view and week into the address bar (`syncUrl`), so the URL only
   * disagrees with the screen when somebody else changed it — and a
   * navigation back to the week the page first drew can be answered from the
   * router's cache with the very same props, which no comparison of them
   * would notice. The focused day is kept when it is still inside the week,
   * so the day view opens where the owner left it. Adjusted during render,
   * React's documented way of resetting state on a changed input.
   */
  const searchParams = useSearchParams();
  const requestedWeek = searchParams.get("week");
  const urlView: CalendarView =
    searchParams.get("view") === "day" ? "day" : "week";
  const urlAnchor =
    requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)
      ? requestedWeek
      : thisWeek;
  const urlKey = `${urlView}|${urlAnchor}`;
  const [seenUrl, setSeenUrl] = useState(urlKey);
  if (seenUrl !== urlKey) {
    setSeenUrl(urlKey);
    const start = weekOf(urlAnchor)[0];
    if (start !== shownWeek) setShownWeek(start);
    if (urlView !== view) setView(urlView);
    const keepsFocus =
      urlView === "day"
        ? focusedDate === urlAnchor
        : weekOf(focusedDate)[0] === start;
    if (!keepsFocus) setFocusedDate(urlAnchor);
  }

  const serverWeek = useMemo<CalendarWeekData>(
    () => ({
      weekStart: serverWeekStart,
      days: serverDays,
      entries: serverEntries,
    }),
    [serverWeekStart, serverDays, serverEntries],
  );

  const keyFor = useCallback((week: string) => `${scope}|${week}`, [scope]);
  useSyncExternalStore(
    weekCache.subscribe,
    weekCache.version,
    weekCache.version,
  );

  /**
   * **The server's render is the freshest copy there is.** It arrives after
   * `router.refresh()` — a write here, ליבי's own `changed`, an approved
   * request — and whatever made the server render again may have changed
   * other weeks too, so everything held is marked stale first and refreshed
   * the next time it is shown. A layout effect, so the fresh week replaces the
   * held one before the browser paints.
   */
  useLayoutEffect(() => {
    weekCache.invalidate();
    weekCache.put(keyFor(serverWeek.weekStart), serverWeek);
  }, [serverWeek, keyFor]);

  const heldWeek =
    weekCache.peek(keyFor(shownWeek)) ??
    (shownWeek === serverWeek.weekStart ? serverWeek : undefined);
  const fetchingWeek = weekCache.isLoading(keyFor(shownWeek));
  const week = useMemo(
    () => heldWeek ?? placeholderWeek(shownWeek, serverWeek, thisWeek),
    [heldWeek, shownWeek, serverWeek, thisWeek],
  );
  const weekDays = week.days;
  const entries = week.entries;
  const weekStart = week.weekStart;

  const { toast } = useToast();

  /**
   * **Edit mode — moving bookings by hand.**
   *
   * ---------------------------------------------------------------------------
   * Off by default, so an ordinary tap on a card still opens it: dragging is
   * a mode the owner enters on purpose, not something a scrolling thumb can
   * set off. Inside it:
   *
   * - **drag** a booking to another time or day — snapped to five minutes, the
   *   ghost red where the same provider is already booked and amber where the
   *   shop's own rules say closed or blocked (see `calendar-edit`);
   * - **tap two** bookings to swap them — the plan comes from the server first
   *   (`previewSwapAction`, the same planner as ליבי's swap) and nothing is
   *   written until the owner confirms it;
   * - or, from the keyboard, Enter to pick a booking up, the arrows to move
   *   it, Enter to put it down — and Space to pick it for a swap.
   *
   * A move lands on screen the moment it is dropped (`useOptimistic`) and
   * the server's answer replaces it; a refusal puts the card back.
   * ---------------------------------------------------------------------------
   */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [swap, setSwap] = useState<SwapPreview | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  /**
   * A move stepping outside the shop's rules, waiting on the owner's yes. The
   * card waits *where it was dropped*, ringed in amber — see `shownEntries` —
   * rather than jumping home and leaving a ghost behind while the question
   * is open.
   */
  const [asking, setAsking] = useState<{
    entry: CalendarEntry;
    move: EntryMove;
    message: string;
  } | null>(null);
  const [saving, startSaving] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [moves, addMoves] = useOptimistic(
    NO_MOVES,
    (current: MoveMap, next: OptimisticMove[]): MoveMap => {
      const merged = { ...current };
      for (const move of next) merged[move.appointmentId] = move;
      return merged;
    },
  );

  /**
   * The week as drawn: the held copy, with any move still being saved — and
   * the one waiting on the owner's yes, which stays where it was dropped.
   */
  const shownEntries = useMemo(() => {
    const held: MoveMap = asking
      ? { ...moves, [asking.move.appointmentId]: asking.move }
      : moves;
    if (held === NO_MOVES) return entries;
    return entries.map((entry) => {
      const move = entry.appointmentId ? held[entry.appointmentId] : undefined;
      if (!move) return entry;
      const moved = movedEntry(entry, move);
      return move.staff ? { ...moved, ...move.staff } : moved;
    });
  }, [entries, moves, asking]);

  /**
   * The week on screen is always on its way to being fresh. A step already
   * asked for it (`goToWeek`), and a load already in flight or answered in
   * the last few seconds is shared rather than repeated — so this only ever
   * does work for a week that arrived some other way: a navigation the
   * router answered from its cache, or a copy held since before a write.
   */
  useEffect(() => {
    weekCache.load(keyFor(shownWeek), SHOWN_MAX_AGE_MS).catch(() => {});
  }, [shownWeek, keyFor]);

  // The neighbours, fetched once the week on screen has drawn, so the next
  // step is usually already in memory.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      weekCache.prefetch(keyFor(shiftDays(shownWeek, -7)), PREFETCH_MAX_AGE_MS);
      weekCache.prefetch(keyFor(shiftDays(shownWeek, 7)), PREFETCH_MAX_AGE_MS);
    }, PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shownWeek, keyFor]);

  /**
   * After any write from this calendar: everything held is suspect, and the
   * server renders the week in the address bar again.
   */
  const refreshDiary = useCallback(() => {
    weekCache.invalidate();
    router.refresh();
  }, [router]);

  /**
   * Hides cropped hours — see `fitHoursSnapshot`. Read like the density, as an
   * external store, so the server renders the default and hydration matches.
   */
  const fitHours = useSyncExternalStore(
    subscribeFitHours,
    fitHoursSnapshot,
    fitHoursServerSnapshot,
  );

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
    for (const entry of shownEntries) {
      if (entry.kind !== "appointment") continue;
      const minutes = entry.endMinutes - entry.startMinutes;
      if (minutes > 0 && (shortest === null || minutes < shortest)) {
        shortest = minutes;
      }
    }
    return shortest;
  }, [shownEntries]);

  const rowPx = hourRowPx(dayView ? "day" : "week", cardMode, shortestMinutes);

  /**
   * One hour of grid, as the rail and every column draw it. A pixel height
   * everywhere but the overview, whose row the stylesheet fits to the frame.
   */
  const hourRow = useMemo(
    () =>
      summaryCards
        ? { className: SUMMARY_HOUR_ROW }
        : { style: { height: rowPx } },
    [summaryCards, rowPx],
  );

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
    if (!dayView) return { days: weekDays, visibleEntries: shownEntries };

    return {
      days: weekDays.slice(focusedIndex, focusedIndex + 1),
      visibleEntries: shownEntries
        .filter((entry) => entry.dayIndex === focusedIndex)
        .map((entry) => ({ ...entry, dayIndex: 0 })),
    };
  }, [dayView, weekDays, shownEntries, focusedIndex]);

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
        // The owner's "crop empty hours" — see `gridBounds`. Not while
        // editing: an hour cropped away is an hour a booking cannot be
        // dragged into.
        { fitToItems: fitHours && !editing },
      ),
    [visibleEntries, days, summaryCards, fitHours, editing],
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
   * Each card's box and floor, worked out once per layout rather than on every
   * render.
   *
   * A hover sets state at the root, and every card used to be rebuilt with it —
   * new style objects, new closures — for a pointer crossing one of them. Built
   * here, each card receives the very same objects until the layout itself
   * changes, and `EntryCard`'s `memo` lets all the others skip.
   */
  const layoutByDay = useMemo(
    () =>
      placedByDay.map((placed, dayIndex) =>
        placed.map((entry) => {
          const toNext = gapsByDay[dayIndex].get(entry.id) ?? null;
          return {
            entry,
            // The gap is what stops the minimum height drawing this card over
            // the one after it — see `placeItem`.
            style: cardBox(placeItem(entry, bounds, undefined, toNext)),
            /**
             * Every mode's floor, capped by the room to the next card below
             * and less the gap that keeps them apart — measured on the grid
             * this card is actually drawn on. In pixels on the grown hour; as a
             * percentage of the grid in the overview, whose hour only the
             * stylesheet knows.
             */
            minHeight: summaryCards
              ? blockMinHeight(toNext, bounds)
              : cardHeightPx(
                  entry.endMinutes - entry.startMinutes,
                  dayView ? "day" : "week",
                  toNext,
                  cardMode,
                  rowPx,
                ),
          };
        }),
      ),
    [placedByDay, gapsByDay, bounds, summaryCards, dayView, cardMode, rowPx],
  );

  // The hover card is supplementary detail about what is under the cursor.
  // Once the dialog is up it is stale and floating over a modal, so it goes.
  const openEntry = useCallback((target: CalendarEntry) => {
    setHovered(null);
    setOpened(target);
  }, []);

  /** The blocks in the week on screen, for the list under the grid. */
  const weekBlocks = useMemo(
    () => shownEntries.filter((entry) => entry.kind === "block"),
    [shownEntries],
  );

  /* ------------------------------------------------------------ edit mode */

  const frameRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const session = useRef<DragSession | null>(null);
  /** Which pair a swap preview is being fetched for — a stale answer is dropped. */
  const planFor = useRef<string | null>(null);

  /** The grid as last drawn, for handlers that outlive the render they came from. */
  const live = useRef({
    bounds,
    entries: shownEntries,
    weekDays,
    dayView,
    focusedIndex,
  });
  useLayoutEffect(() => {
    live.current = {
      bounds,
      entries: shownEntries,
      weekDays,
      dayView,
      focusedIndex,
    };
  });

  /** Where `entry` would land at `startMinutes` on `dayIndex`, and what is in the way. */
  const landing = (
    entry: CalendarEntry,
    dayIndex: number,
    startMinutes: number,
    via: DragView["via"],
  ): DragView => {
    const facts = live.current;
    const endMinutes = startMinutes + (entry.endMinutes - entry.startMinutes);
    return {
      entryId: entry.id,
      appointmentId: entry.appointmentId ?? "",
      dayIndex,
      startMinutes,
      endMinutes,
      via,
      conflict: dropConflict(
        facts.entries,
        {
          appointmentId: entry.appointmentId ?? "",
          staffId: entry.staffId,
          dayIndex,
          startMinutes,
          endMinutes,
        },
        facts.weekDays[dayIndex]?.open ?? [],
      ),
    };
  };

  /** The landing under a pointer at (x, y). */
  const aim = (drag: DragSession, x: number, y: number) => {
    const grid = gridRef.current;
    const spot = grid ? columnAt(grid, x, y) : null;
    if (!spot) return null;
    const limits = live.current.bounds;
    return landing(
      drag.entry,
      spot.dayIndex,
      dropStart({
        pointerMinutes: minutesAt(spot.offsetY, spot.height, limits),
        grabOffset: drag.grabOffset,
        duration: drag.entry.endMinutes - drag.entry.startMinutes,
        bounds: limits,
      }),
      "pointer",
    );
  };

  /** Re-renders only when the landing changes — every five minutes, not every pixel. */
  const showLanding = (next: DragView | null) => {
    setDrag((current) =>
      current &&
      next &&
      current.via === next.via &&
      current.dayIndex === next.dayIndex &&
      current.startMinutes === next.startMinutes
        ? current
        : next,
    );
  };

  const follow = (x: number, y: number) => {
    const drag = session.current;
    if (!drag) return;
    drag.lastX = x;
    drag.lastY = y;
    if (!drag.active) {
      if (Math.hypot(x - drag.originX, y - drag.originY) < DRAG_THRESHOLD_PX) {
        return;
      }
      drag.active = true;
    }
    showLanding(aim(drag, x, y));
    if (!drag.raf) {
      drag.raf = requestAnimationFrame(() => handlers.current?.scrollEdges());
    }
  };

  /**
   * Scrolls the frame while a drag is held near its edge, so a booking can be
   * carried to an hour — or, on a phone, a day — that is not on screen.
   */
  const scrollEdges = () => {
    const drag = session.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    drag.raf = 0;
    if (!drag.active) return;

    const rect = frame.getBoundingClientRect();
    const speed = (distance: number) =>
      Math.round(EDGE_SPEED_PX * Math.min(1, Math.max(0, 1 - distance / EDGE_PX)));
    const top = rect.top + DAY_HEADER_PX;
    const dy =
      drag.lastY < top + EDGE_PX
        ? -speed(drag.lastY - top)
        : drag.lastY > rect.bottom - EDGE_PX
          ? speed(rect.bottom - drag.lastY)
          : 0;
    const dx =
      drag.lastX < rect.left + EDGE_PX
        ? -speed(drag.lastX - rect.left)
        : drag.lastX > rect.right - EDGE_PX
          ? speed(rect.right - drag.lastX)
          : 0;
    if (dx === 0 && dy === 0) return;

    frame.scrollBy(dx, dy);
    showLanding(aim(drag, drag.lastX, drag.lastY));
    drag.raf = requestAnimationFrame(() => handlers.current?.scrollEdges());
  };

  const beginDrag = (
    entry: CalendarEntry,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    // One decision at a time: a question in the tray is answered first, and
    // a write in flight lands before the next is planned against it.
    if (event.button !== 0 || session.current || !entry.appointmentId) return;
    if (asking || saving) return;
    const grid = gridRef.current;
    const spot = grid ? columnAt(grid, event.clientX, event.clientY) : null;
    if (!spot) return;

    const facts = live.current;
    // The week's own span, not the day view's copy remapped onto column 0.
    const own = facts.entries.find((each) => each.id === entry.id) ?? entry;
    const { pointerId } = event;

    const onMove = (move: PointerEvent) => {
      if (move.pointerId === pointerId) {
        handlers.current?.follow(move.clientX, move.clientY);
      }
    };
    const onEnd = (end: PointerEvent) => {
      if (end.pointerId === pointerId) {
        handlers.current?.finishDrag(end.type === "pointerup");
      }
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      handlers.current?.finishDrag(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    window.addEventListener("keydown", onKey);

    session.current = {
      entry: own,
      pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grabOffset:
        minutesAt(spot.offsetY, spot.height, facts.bounds) - own.startMinutes,
      active: false,
      raf: 0,
      detach: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        window.removeEventListener("keydown", onKey);
      },
    };
  };

  /** Lets go: a tap picks the card for a swap; a drag asks to move it. */
  const finishDrag = (commit: boolean) => {
    const drag = session.current;
    if (!drag) return;
    session.current = null;
    drag.detach();
    if (drag.raf) cancelAnimationFrame(drag.raf);

    if (!drag.active) {
      setDrag(null);
      if (commit) toggleSelect(drag.entry);
      return;
    }

    const target = commit ? aim(drag, drag.lastX, drag.lastY) : null;
    setDrag(null);
    if (target) commitMove(drag.entry, target);
  };

  const planSwap = (firstId: string, secondId: string) => {
    const pair = `${firstId}|${secondId}`;
    planFor.current = pair;
    startPlanning(async () => {
      const result = await previewSwapAction({ firstId, secondId });
      // The owner changed their pick while the plan was on its way.
      if (planFor.current !== pair) return;
      if (result.ok) {
        setSwap(result.preview);
      } else {
        toast(result.error, "error");
        setSelected([firstId]);
        refuse(secondId);
      }
    });
  };

  const toggleSelect = (entry: CalendarEntry) => {
    const id = entry.appointmentId;
    if (!id || asking || saving) return;
    setSwap(null);
    planFor.current = null;
    if (selected.includes(id)) {
      setSelected(selected.filter((other) => other !== id));
      return;
    }
    const next = selected.length >= 2 ? [id] : [...selected, id];
    setSelected(next);
    if (next.length === 2) planSwap(next[0], next[1]);
  };

  const saveMove = (entry: CalendarEntry, move: EntryMove, force: boolean) => {
    setAsking(null);
    startSaving(async () => {
      addMoves([move]);
      const time = minutesToLabel(move.startMinutes);
      const result = await rescheduleAppointmentAction({
        appointmentId: move.appointmentId,
        date: move.date,
        time,
        force,
      });
      if (result.ok) {
        toast(
          `התור של ${entry.title} הועבר ${landingPhrase(entry.date, { date: move.date, time })}`,
          "success",
        );
        refreshDiary();
      } else if ("confirm" in result) {
        // A rule only the server knows — a notice period, the booking
        // lattice. Asked, as the dialog asks.
        setAsking({ entry, move, message: result.message });
      } else {
        toast(result.error, "error");
        refuse(move.appointmentId);
      }
    });
  };

  const commitMove = (entry: CalendarEntry, target: DragView) => {
    if (
      target.dayIndex === entry.dayIndex &&
      target.startMinutes === entry.startMinutes
    ) {
      return;
    }
    const day = live.current.weekDays[target.dayIndex];
    if (!day || !entry.appointmentId) return;

    if (target.conflict?.kind === "clash") {
      // The database would refuse it anyway — `appointments_no_overlap_staff`.
      toast(
        `ב-${minutesToLabel(target.conflict.startMinutes)} כבר משובץ ${target.conflict.title} אצל אותו נותן שירות. התור נשאר במקומו.`,
        "error",
      );
      refuse(entry.appointmentId);
      return;
    }

    const move: EntryMove = {
      appointmentId: entry.appointmentId,
      dayIndex: target.dayIndex,
      date: day.date,
      startMinutes: target.startMinutes,
    };

    if (target.conflict) {
      // The shop's own rules: asked before anything moves.
      setAsking({
        entry,
        move,
        message:
          target.conflict.kind === "blocked"
            ? `המועד חסום ביומן (${target.conflict.title}). לשבץ בכל זאת?`
            : "המועד מחוץ לשעות הפעילות. לשבץ בכל זאת?",
      });
      return;
    }

    saveMove(entry, move, false);
  };

  const confirmSwap = () => {
    const preview = swap;
    if (!preview) return;
    const facts = live.current;
    const find = (id: string) =>
      facts.entries.find((entry) => entry.appointmentId === id);
    const first = find(preview.first.appointmentId);
    const second = find(preview.second.appointmentId);

    const optimistic: OptimisticMove[] = [];
    for (const [leg, other] of [
      [preview.first, second],
      [preview.second, first],
    ] as const) {
      const dayIndex = facts.weekDays.findIndex((day) => day.date === leg.date);
      if (dayIndex < 0) continue;
      optimistic.push({
        appointmentId: leg.appointmentId,
        dayIndex,
        date: leg.date,
        startMinutes: timeToMinutes(leg.time),
        staff:
          other && other.staffId === leg.staffId
            ? {
                staffId: other.staffId,
                staffName: other.staffName,
                staffColor: other.staffColor,
              }
            : undefined,
      });
    }

    setSwap(null);
    setSelected([]);
    planFor.current = null;
    startSaving(async () => {
      addMoves(optimistic);
      const result = await swapAppointmentsAction(preview.request);
      if (result.ok) {
        toast(
          `התורים של ${preview.first.clientName} ו${preview.second.clientName} הוחלפו`,
          "success",
        );
        refreshDiary();
      } else {
        toast(result.error, "error");
      }
    });
  };

  const cancelEdit = () => {
    setSelected([]);
    setSwap(null);
    setAsking(null);
    planFor.current = null;
  };

  /** Enter picks up and puts down, the arrows carry it, Space picks it for a swap. */
  const keyMove = (
    entry: CalendarEntry,
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    const facts = live.current;
    const own = facts.entries.find((each) => each.id === entry.id) ?? entry;
    if (!canMove(own) || asking || saving) return;
    const lifted =
      drag?.via === "keyboard" && drag.entryId === own.id ? drag : null;

    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (lifted) {
          setDrag(null);
          commitMove(own, lifted);
        } else {
          setDrag(landing(own, own.dayIndex, own.startMinutes, "keyboard"));
        }
        return;
      }
      case " ": {
        event.preventDefault();
        toggleSelect(own);
        return;
      }
      case "Escape": {
        if (lifted) {
          event.preventDefault();
          setDrag(null);
        }
        return;
      }
      case "ArrowUp":
      case "ArrowDown": {
        if (!lifted) return;
        event.preventDefault();
        const step =
          (event.shiftKey ? 60 : SNAP_MINUTES) *
          (event.key === "ArrowUp" ? -1 : 1);
        setDrag(
          landing(
            own,
            lifted.dayIndex,
            dropStart({
              pointerMinutes: lifted.startMinutes + step,
              grabOffset: 0,
              duration: own.endMinutes - own.startMinutes,
              bounds: facts.bounds,
            }),
            "keyboard",
          ),
        );
        return;
      }
      case "ArrowLeft":
      case "ArrowRight": {
        if (!lifted || facts.dayView) return;
        event.preventDefault();
        // Right to left: tomorrow is to the left.
        const dayIndex = lifted.dayIndex + (event.key === "ArrowLeft" ? 1 : -1);
        if (dayIndex < 0 || dayIndex >= facts.weekDays.length) return;
        setDrag(landing(own, dayIndex, lifted.startMinutes, "keyboard"));
      }
    }
  };

  /** A booking picked up from the keyboard is put back when focus leaves it. */
  const dropKeyboardLift = (entry: CalendarEntry) => {
    if (drag?.via === "keyboard" && drag.entryId === entry.id) setDrag(null);
  };

  const handlers = useRef<{
    beginDrag: typeof beginDrag;
    follow: typeof follow;
    scrollEdges: typeof scrollEdges;
    finishDrag: typeof finishDrag;
    keyMove: typeof keyMove;
    dropKeyboardLift: typeof dropKeyboardLift;
  } | null>(null);
  useLayoutEffect(() => {
    handlers.current = {
      beginDrag,
      follow,
      scrollEdges,
      finishDrag,
      keyMove,
      dropKeyboardLift,
    };
  });

  /**
   * What every card is handed in edit mode — one object for the life of the
   * calendar, so `memo` still lets the cards skip; each call reaches the
   * handlers of the latest render.
   */
  const editHandlers = useMemo<EditHandlers>(
    () => ({
      pointerDown: (entry, event) => handlers.current?.beginDrag(entry, event),
      keyDown: (entry, event) => handlers.current?.keyMove(entry, event),
      blur: (entry) => handlers.current?.dropKeyboardLift(entry),
    }),
    [],
  );

  // A drag that is still held when the calendar goes away lets go of the window.
  useEffect(
    () => () => {
      const held = session.current;
      if (!held) return;
      held.detach();
      if (held.raf) cancelAnimationFrame(held.raf);
    },
    [],
  );

  const toggleEditing = () => {
    const next = !editing;
    setEditing(next);
    setHovered(null);
    setDrag(null);
    cancelEdit();
    if (!next) handlers.current?.finishDrag(false);
  };

  /** Where the ghost is drawn: its column, if that column is on screen. */
  const ghost = drag;
  const ghostEntry = ghost
    ? shownEntries.find((entry) => entry.id === ghost.entryId)
    : undefined;

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

  /**
   * Steps to another week without a navigation — see `weekCache`.
   *
   * The grid moves at once: from memory when the week was seen or prefetched,
   * or as its dates and hours with the cards to follow when it was not. A week
   * held from earlier is shown as it was and refreshed behind the owner. If
   * the fetch fails — a session that ended, a network that went away — the
   * step becomes a real navigation, which lands on the week or on the login
   * page, either of which says more than a grid that never fills.
   */
  const goToWeek = useCallback(
    (target: string, nextFocus: string) => {
      const start = weekOf(target)[0];
      const anchor = view === "day" ? nextFocus : start;
      setShownWeek(start);
      setFocusedDate(nextFocus);
      // A swap is between two cards on screen; picks from another week go.
      setSelected([]);
      setSwap(null);
      syncUrl(view, anchor);
      weekCache.load(keyFor(start), SHOWN_MAX_AGE_MS).catch(() => {
        window.location.assign(`?view=${view}&week=${anchor}`);
      });
    },
    [view, keyFor, syncUrl],
  );

  /**
   * One day on, or one day back, in the day view. Inside the week it is a
   * change of column; across the edge it is `goToWeek`, so Saturday's "next"
   * lands on Sunday rather than on a page load.
   */
  const stepDay = useCallback(
    (delta: 1 | -1) => {
      const next = weekDays[focusedIndex + delta];
      if (next) {
        setFocusedDate(next.date);
        syncUrl("day", next.date);
        return;
      }
      const date = shiftDays(weekDays[focusedIndex]?.date ?? focusedDate, delta);
      goToWeek(date, date);
    },
    [weekDays, focusedIndex, focusedDate, syncUrl, goToWeek],
  );

  /**
   * A week on, or back, in the week view — the focused day moves with it, so
   * switching to the day view afterwards opens the same weekday there.
   */
  const stepWeek = useCallback(
    (delta: 1 | -1) => {
      const target = shiftDays(weekStart, delta * 7);
      goToWeek(
        target,
        shiftDays(weekDays[focusedIndex]?.date ?? weekStart, delta * 7),
      );
    },
    [weekStart, weekDays, focusedIndex, goToWeek],
  );

  const step = (delta: 1 | -1) => (dayView ? stepDay(delta) : stepWeek(delta));

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
            href={`?view=${view}&week=${dayView ? shiftDays(focusedDate, -1) : shiftDays(weekStart, -7)}`}
            onStep={() => step(-1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </ArrowButton>

          <Link
            href={`?view=${view}&week=${thisWeek}`}
            onClick={(event) => {
              // A modified click is a request for another tab.
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              goToWeek(thisWeek, thisWeek);
            }}
            className={cn(
              "glass-control inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-zinc-900 dark:text-zinc-100",
              focusRing,
            )}
          >
            {dayView ? "היום" : "השבוע"}
          </Link>

          <ArrowButton
            label={dayView ? "היום הבא" : "השבוע הבא"}
            href={`?view=${view}&week=${dayView ? shiftDays(focusedDate, 1) : shiftDays(weekStart, 7)}`}
            onStep={() => step(1)}
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
        {/**
         * **Only the hours that hold something.** The grid normally spans the
         * opening hours and an hour either side; cropped, it runs from the
         * first booking to the last — see `gridBounds`. Offered in both views,
         * because an empty morning is scrolled past in a day as much as in a
         * week, and kept as a preference beside the density.
         *
         * A pressed toggle rather than two options: the label says what it
         * does, `aria-pressed` says whether it is doing it.
         */}
        <div className="glass-inset flex items-center rounded-full p-1">
          <button
            type="button"
            onClick={() => chooseFitHours(!fitHours)}
            aria-pressed={fitHours}
            aria-label={FIT_HOURS_LABEL}
            title={FIT_HOURS_LABEL}
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-colors",
              focusRing,
              fitHours
                ? "glass-control text-zinc-950 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            <FoldVertical className="size-4" aria-hidden />
          </button>
        </div>

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

        {/* Edit mode: a pressed toggle, ink when on so the mode is never in
            doubt — the dashboard's own "this is active" colour. */}
        <button
          type="button"
          onClick={toggleEditing}
          aria-pressed={editing}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-bold transition-colors",
            focusRing,
            editing
              ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              : "glass-control text-zinc-900 dark:text-zinc-100",
          )}
        >
          <Move className="size-4" aria-hidden />
          עריכה
        </button>

        <button
          type="button"
          onClick={() => setAdding(days[0]?.date ?? weekStart)}
          className={cn(btnPrimary, "h-9 px-4 text-xs")}
        >
          <CalendarPlus className="size-4" aria-hidden />
          אירוע חדש
        </button>
      </div>

      {editing ? (
        <div className="glass-inset mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3.5 py-2.5 text-xs text-zinc-700 dark:text-zinc-300">
          <Move className="size-4 shrink-0 text-zinc-500" aria-hidden />
          <p className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              מצב עריכה.
            </span>{" "}
            גררו תור כדי להזיז אותו — בקפיצות של 5 דקות. הקישו על שני תורים כדי
            להחליף ביניהם. הלקוחות לא מקבלים הודעה על שינוי — כדאי לעדכן אותם.
          </p>
          <button
            type="button"
            onClick={toggleEditing}
            className={cn(
              "h-8 shrink-0 rounded-full bg-zinc-900 px-3.5 text-xs font-bold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
              focusRing,
            )}
          >
            סיום
          </button>
        </div>
      ) : null}

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
        ref={frameRef}
        // A week whose bookings have not arrived yet: its dates and hours are
        // drawn — see `placeholderWeek` — and the frame says the rest is coming.
        aria-busy={!heldWeek}
        className={cn(
          cardClass,
          "glass-frame overflow-auto overscroll-x-contain",
          "max-h-[68dvh] sm:max-h-[76dvh]",
          "transition-opacity duration-200",
          !heldWeek && "opacity-60",
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
            {/* The step has already happened; this only says the cards are on
                their way. In the rail's empty corner, where the eye is when
                the week changes, and where it costs the toolbar no room — on
                a phone that room is a whole row. */}
            <div className="flex items-center justify-center text-zinc-500 dark:text-zinc-400">
              <span role="status">
                {fetchingWeek ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    <span className="sr-only">טוען את השבוע…</span>
                  </>
                ) : null}
              </span>
            </div>
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
            ref={gridRef}
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
                // The column's day in the week — what a drag lands on.
                data-day-column={dayView ? focusedIndex : dayIndex}
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

                {layoutByDay[dayIndex].map(({ entry, style, minHeight }) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    focused={entry.appointmentId === focused}
                    dayView={dayView}
                    variant={
                      entry.staffId ? (variants.get(entry.staffId) ?? 0) : 0
                    }
                    card={cardMode}
                    minHeight={minHeight}
                    onHoverChange={editing ? noHover : setHovered}
                    onOpen={openEntry}
                    edit={editing ? editHandlers : null}
                    selected={
                      entry.appointmentId !== null &&
                      selected.includes(entry.appointmentId)
                    }
                    lifted={ghost?.entryId === entry.id}
                    awaiting={
                      asking !== null &&
                      entry.appointmentId === asking.move.appointmentId
                    }
                    saving={
                      entry.appointmentId !== null &&
                      moves[entry.appointmentId] !== undefined
                    }
                    style={style}
                  />
                ))}

                {ghost &&
                ghostEntry &&
                ghost.dayIndex === (dayView ? focusedIndex : dayIndex) ? (
                  <DragGhost
                    ghost={ghost}
                    title={ghostEntry.title}
                    bounds={bounds}
                    dayView={dayView}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Suppressed while the dialog is open: the two describe the same
          appointment, and the tooltip would sit on top of the modal. */}
      {hovered && !opened ? <EntryPopover hovered={hovered} /> : null}

      {/* What a screen reader hears while a booking is carried: where it
          would land, and what is in the way. */}
      <p role="status" aria-live="polite" className="sr-only">
        {drag && ghostEntry
          ? `${ghostEntry.title}: יום ${weekdayLabel(weekDays[drag.dayIndex]?.date ?? weekStart)}, ${minutesToLabel(drag.startMinutes)}${
              drag.conflict?.kind === "clash"
                ? ` — חופף ל${drag.conflict.title}`
                : drag.conflict
                  ? " — מחוץ לשעות או חסום"
                  : ""
            }`
          : ""}
      </p>

      {editing && (selected.length > 0 || asking) ? (
        <EditTray
          asking={asking?.message ?? null}
          firstName={
            shownEntries.find((entry) => entry.appointmentId === selected[0])
              ?.title ?? null
          }
          swapLines={
            swap
              ? [swap.first, swap.second].map((leg) => ({
                  id: leg.appointmentId,
                  name: leg.clientName,
                  // Each against its own day: the day is named only for the
                  // booking whose day actually changes.
                  where: landingPhrase(
                    shownEntries.find(
                      (entry) => entry.appointmentId === leg.appointmentId,
                    )?.date ?? leg.date,
                    { date: leg.date, time: leg.time },
                  ),
                }))
              : null
          }
          repacked={swap?.repacked ?? false}
          planning={planning}
          saving={saving}
          onConfirmMove={() =>
            asking ? saveMove(asking.entry, asking.move, true) : undefined
          }
          onConfirmSwap={confirmSwap}
          onCancel={cancelEdit}
        />
      ) : null}

      {opened ? (
        <AppointmentDialog
          entry={opened}
          staff={staff}
          timezone={timezone}
          onClose={() => setOpened(null)}
          onChanged={refreshDiary}
        />
      ) : null}

      {adding ? (
        <BlockDialog
          days={weekDays}
          staff={staff}
          initialDate={adding}
          timezone={timezone}
          onClose={() => setAdding(null)}
          onSaved={refreshDiary}
        />
      ) : null}

      <BlockList blocks={weekBlocks} onChanged={refreshDiary} />
    </div>
  );
}

/**
 * A step through time, taken in memory.
 *
 * `onStep` moves the calendar in its own state — see `goToWeek`. It is still a
 * link underneath, with the step's real address, so middle-click, a modified
 * click and "open in new tab" keep working and land on the same place.
 */
function ArrowButton({
  href,
  label,
  onStep,
  children,
}: {
  href: string;
  label: string;
  onStep: () => void;
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
        // A modified click is a request for another tab — leave it to the link.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onStep();
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

/**
 * One booking or block on the grid.
 *
 * `memo`, with every prop it takes held stable by the grid — see
 * `layoutByDay` — so the root's hover state repaints the hover card and
 * nothing else.
 */
const EntryCard = memo(function EntryCard({
  entry,
  style,
  dayView,
  variant,
  card,
  minHeight,
  focused,
  onHoverChange,
  onOpen,
  edit,
  selected,
  lifted,
  awaiting,
  saving,
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
  /**
   * Edit mode's handlers, or null outside it. In edit mode a card is picked up
   * rather than opened: dragged to move it, tapped to pick it for a swap.
   */
  edit: EditHandlers | null;
  /** Picked for a swap. */
  selected: boolean;
  /** Being carried — the ghost shows where it would land. */
  lifted: boolean;
  /** Dropped outside the shop's rules, waiting on the owner's yes. */
  awaiting: boolean;
  /** Moved on screen, waiting on the server. */
  saving: boolean;
}) {
  const status = entry.kind === "appointment" ? entry.status : null;
  /** Can be picked up in edit mode — see `canMove`. */
  const movable = edit !== null && canMove(entry);
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
    /**
     * **Edit mode.** A card that can move says so with the cursor and gives
     * the pointer to the drag — `touch-none`, so a finger on it carries the
     * booking instead of scrolling the week; the grid between cards still
     * scrolls. What cannot move — a block, a settled booking, half of one that
     * crosses midnight — steps back rather than pretending.
     */
    edit &&
      (movable
        ? "cursor-grab touch-none select-none active:cursor-grabbing"
        : "cursor-not-allowed opacity-45"),
    selected &&
      "z-20 ring-2 ring-zinc-900 ring-offset-1 ring-offset-white shadow-lg dark:ring-zinc-100 dark:ring-offset-zinc-950",
    lifted && "opacity-35",
    // Amber, the colour of a rule being asked about — as in the tray below.
    awaiting &&
      "z-20 ring-2 ring-amber-500 ring-offset-1 ring-offset-white shadow-lg dark:ring-amber-400 dark:ring-offset-zinc-950",
    saving && "animate-pulse",
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
        tabIndex={edit ? -1 : 0}
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

  if (edit) {
    /**
     * The same card, as something to carry. `aria-pressed` is the swap pick;
     * the description says how to move it, since a drag is not something a
     * keyboard or a screen reader can see.
     */
    return (
      <button
        type="button"
        style={boxStyle}
        id={`entry-${entry.appointmentId}`}
        aria-pressed={movable ? selected : undefined}
        aria-disabled={!movable}
        aria-label={description}
        aria-roledescription={movable ? "תור להזזה" : undefined}
        aria-keyshortcuts={movable ? "Enter Space" : undefined}
        title={
          movable
            ? `${description} — גררו להזזה, הקישו לבחירה להחלפה`
            : description
        }
        onPointerDown={movable ? (event) => edit.pointerDown(entry, event) : undefined}
        onKeyDown={movable ? (event) => edit.keyDown(entry, event) : undefined}
        onBlur={() => edit.blur(entry)}
        className={className}
      >
        {body}
        {selected ? (
          <span
            aria-hidden
            className="absolute end-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
          >
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        ) : null}
      </button>
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
});

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

/**
 * Where a carried booking would land — dashed, with its time, and coloured by
 * what is in the way.
 *
 * Neutral when the slot is free; **red** where the same provider is already
 * booked, because that drop will be refused; **amber** where it steps outside
 * the shop's hours or onto a block, because that one will be asked about. The
 * same amber-for-a-rule, red-for-a-refusal split as the dialog's reschedule.
 */
function DragGhost({
  ghost,
  title,
  bounds,
  dayView,
}: {
  ghost: DragView;
  title: string;
  bounds: GridBounds;
  dayView: boolean;
}) {
  const box = placeItem(
    {
      id: ghost.entryId,
      dayIndex: 0,
      startMinutes: ghost.startMinutes,
      endMinutes: ghost.endMinutes,
      lane: 0,
      lanes: 1,
    },
    bounds,
  );
  const clash = ghost.conflict?.kind === "clash";
  const rule = ghost.conflict !== null && !clash;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-30 flex min-h-7 flex-col justify-start overflow-hidden border-2 border-dashed px-1.5 py-0.5 shadow-lg backdrop-blur-sm",
        dayView ? "rounded-2xl" : "rounded-xl",
        clash
          ? "border-rose-600 bg-rose-50/90 text-rose-900 dark:border-rose-400 dark:bg-rose-950/80 dark:text-rose-100"
          : rule
            ? "border-amber-600 bg-amber-50/90 text-amber-900 dark:border-amber-400 dark:bg-amber-950/80 dark:text-amber-100"
            : "border-zinc-900/70 bg-white/85 text-zinc-900 dark:border-zinc-100/70 dark:bg-zinc-900/85 dark:text-zinc-50",
      )}
      style={cardBox(box)}
    >
      <span className="truncate text-[11px]/4 font-bold tabular-nums">
        {minutesToLabel(ghost.startMinutes)}–{minutesToLabel(ghost.endMinutes)}
      </span>
      <span className="truncate text-[10px]/4 font-medium opacity-90">
        {ghost.conflict?.kind === "clash"
          ? `תפוס · ${ghost.conflict.title}`
          : ghost.conflict?.kind === "blocked"
            ? `חסום · ${ghost.conflict.title}`
            : ghost.conflict?.kind === "closed"
              ? "מחוץ לשעות"
              : title}
      </span>
    </div>
  );
}

/**
 * The decision edit mode is waiting on, above the dock: a swap to confirm, a
 * rule to step outside of, or the second card still to pick.
 *
 * One tray rather than a modal, because edit mode is a sequence of small
 * decisions made while looking at the calendar — covering it to ask would hide
 * the very thing being decided about. Fixed above the phone's dock and the
 * safe area, like the ליבי card, and centred on a wide screen.
 */
function EditTray({
  asking,
  firstName,
  swapLines,
  repacked,
  planning,
  saving,
  onConfirmMove,
  onConfirmSwap,
  onCancel,
}: {
  /** The rule a move steps outside of, waiting on a yes. */
  asking: string | null;
  /** The first card picked for a swap. */
  firstName: string | null;
  /** The planned swap, one line a booking — null until it is planned. */
  swapLines: { id: string; name: string; where: string }[] | null;
  repacked: boolean;
  planning: boolean;
  saving: boolean;
  onConfirmMove: () => void;
  onConfirmSwap: () => void;
  onCancel: () => void;
}) {
  const quietButton = cn(
    "h-9 rounded-full px-3.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-900/5 dark:text-zinc-300 dark:hover:bg-white/10",
    focusRing,
  );

  return (
    <div
      role="region"
      aria-label="עריכת היומן"
      aria-live="polite"
      className={cn(
        "glass-float animate-fade fixed inset-x-3 z-40 mx-auto max-w-md rounded-2xl p-3",
        "bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)_+_5.25rem)] md:bottom-8",
      )}
    >
      {asking ? (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-start gap-2 text-xs leading-relaxed font-medium text-amber-900 dark:text-amber-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {asking}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmMove}
              disabled={saving}
              className={cn(
                "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-amber-600 px-3 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60",
                focusRing,
              )}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              לשבץ בכל זאת
            </button>
            <button type="button" onClick={onCancel} className={quietButton}>
              ביטול
            </button>
          </div>
        </div>
      ) : swapLines ? (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-center gap-2 text-sm font-bold text-zinc-950 dark:text-zinc-50">
            <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
            להחליף בין שני התורים?
          </p>
          <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
            {swapLines.map((line) => (
              <li key={line.id} className="tabular-nums">
                {/* "התור" agrees with the verb, so the line never has to guess
                    the client's gender. */}
                התור של{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {line.name}
                </span>{" "}
                יעבור {line.where}
              </li>
            ))}
          </ul>
          {repacked ? (
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              התורים צמודים ובאורך שונה, אז הם מחליפים סדר בתוך אותו רצף — כל אחד
              שומר על האורך שלו.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmSwap}
              disabled={saving}
              className={cn(btnPrimary, "h-9 flex-1 text-xs")}
            >
              <ArrowLeftRight className="size-3.5" aria-hidden />
              החלפה
            </button>
            <button type="button" onClick={onCancel} className={quietButton}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {planning ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-zinc-500"
              aria-hidden
            />
          ) : (
            <ArrowLeftRight
              className="size-4 shrink-0 text-zinc-500"
              aria-hidden
            />
          )}
          <p className="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
            {planning
              ? "בודקים את ההחלפה…"
              : firstName
                ? `נבחר התור של ${firstName} — הקישו על תור נוסף כדי להחליף ביניהם.`
                : "הקישו על תור נוסף כדי להחליף ביניהם."}
          </p>
          <button type="button" onClick={onCancel} className={quietButton}>
            ביטול
          </button>
        </div>
      )}
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
  onSaved,
}: {
  days: CalendarDay[];
  staff: { id: string; name: string; color: string }[];
  initialDate: string;
  timezone: string;
  onClose: () => void;
  /** After the row is written — the calendar refreshes what it holds. */
  onSaved: () => void;
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
        onSaved();
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

/**
 * The blocks in the week on screen, listed below the grid so they can be
 * removed. Inside the calendar rather than beside it on the page, so it lists
 * the week the owner has stepped to rather than the one the page first drew.
 */
function BlockList({
  blocks,
  onChanged,
}: {
  blocks: CalendarEntry[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (blocks.length === 0) return null;

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteStaffTimeOffAction(id);
      if (result.ok) {
        toast(result.message ?? "החסימה הוסרה", "success");
        onChanged();
      } else {
        toast(result.error, "error");
      }
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
