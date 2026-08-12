"use client";

import { useState, useTransition } from "react";
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
const HOUR_ROW = "h-20";

/** Below this, a card gets one row instead of two. */
const COMPACT_BELOW_MIN = 30;

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
export function WeekCalendar({
  days,
  entries,
  weekStart,
  previousWeek,
  nextWeek,
  thisWeek,
  staff,
  timezone,
}: {
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

  const bounds = gridBounds(
    entries,
    days.flatMap((day) => day.open),
  );
  const rows = hourRows(bounds);

  // Lanes are assigned per day: an overlap on Tuesday must not narrow Monday.
  const placedByDay = days.map((_, dayIndex) =>
    assignLanes(entries.filter((entry) => entry.dayIndex === dayIndex)),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {/* Chevrons point the way the week moves, which in RTL is the
              opposite of the arrow's own direction. */}
          <WeekLink href={`?week=${nextWeek}`} label="השבוע הבא">
            <ChevronLeft className="size-4" aria-hidden />
          </WeekLink>
          <Link
            href={`?week=${thisWeek}`}
            className={cn(btnSecondary, "h-9 px-4 text-xs")}
          >
            השבוע
          </Link>
          <WeekLink href={`?week=${previousWeek}`} label="השבוע הקודם">
            <ChevronRight className="size-4" aria-hidden />
          </WeekLink>
        </div>

        <button
          type="button"
          onClick={() => setAdding(days[0]?.date ?? weekStart)}
          className={cn(btnPrimary, "h-9 px-4 text-xs")}
        >
          <CalendarPlus className="size-4" aria-hidden />
          חסימה חדשה
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
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-b border-zinc-200 dark:border-zinc-800">
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

          <div className="grid grid-cols-[3rem_repeat(7,1fr)]">
            {/* Hour rail */}
            <div>
              {rows.map((hour) => (
                <div
                  key={hour}
                  className={cn(
                    HOUR_ROW,
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
                      HOUR_ROW,
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

function WeekLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
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
  onHoverChange,
}: {
  entry: CalendarEntry;
  style: React.CSSProperties;
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
  const compact = entry.endMinutes - entry.startMinutes < COMPACT_BELOW_MIN;

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
        entry.kind === "block"
          ? "bg-zinc-100/70 text-zinc-600 ring-zinc-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700"
          : cn(
              // Translucent and muted rather than a solid fill: the card sits
              // over the open-hours band, and letting that read through is what
              // keeps a busy week from turning into a wall of colour.
              "bg-white/75 text-zinc-900 ring-zinc-200/80",
              "dark:bg-zinc-900/70 dark:text-zinc-50 dark:ring-zinc-700/80",
              cancelled && "opacity-55",
            ),
      )}
    >
      {/* The bar is the only saturated thing on the card, which is what lets it
          carry meaning at a glance across seven columns. */}
      <span
        aria-hidden
        className={cn("w-1 shrink-0 rounded-s-lg", accentBar(entry))}
      />

      <div className="min-w-0 flex-1 px-1.5 py-1">
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

      {entry.status ? (
        <div className="mt-2">
          <StatusChip status={entry.status} />
        </div>
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
