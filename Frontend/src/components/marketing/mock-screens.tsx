import type { CSSProperties, ReactNode } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid2x2,
  Hourglass,
  MessageCircle,
  Move,
  Phone,
  Plus,
  Rows3,
  Search,
  StickyNote,
  Users,
} from "lucide-react";

import {
  assignLanes,
  cardBox,
  cardHeightPx,
  gapsToNext,
  gridBounds,
  hourRowPx,
  hourRows,
  lineBudget,
  minutesToLabel,
  placeItem,
} from "@/lib/calendar-layout";
import { cn } from "@/lib/utils";

import {
  MockAgendaRow,
  MockDock,
  MockLibiCard,
  MockVoiceGlow,
} from "./mock-kit";

/**
 * The four screens the landing page shows, drawn with the dashboard's own
 * classes — see `mock-kit`. Sample names and figures throughout; each screen's
 * frame carries a Hebrew description for anyone who cannot see it.
 */

/** The agenda's header: the title, and the gradient link to the full calendar. */
function AgendaHeader() {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        היומן
      </p>
      <span className="inline-flex items-center gap-2 rounded-full bg-[image:var(--brand-gradient)] px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/25">
        <CalendarRange className="size-4" />
        יומן מלא
      </span>
    </div>
  );
}

/** A dashboard page title, as `PageHeader` draws it. */
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <p className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
    </div>
  );
}

/** The screen's scroll area: the dashboard's own padding. */
function Page({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-6">{children}</div>;
}

/* -------------------------------------------------------------------------- */

/**
 * **The hero: the agenda, with ליבי in the middle of a sentence.**
 *
 * The owner has just said "תזיזי את דנה לארבע". She found the booking and is
 * asking before she moves it — the move is on the button, the microphone has
 * reopened for a spoken yes, and her glow is up along the bottom. Dana's card
 * is still at 14:00, because nothing has moved yet: the page does not show a
 * change that has not happened.
 */
export function AgendaScreen() {
  return (
    <>
      <Page>
        <AgendaHeader />

        <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-50">
            היום 7 תורים
            <span className="mx-2 text-zinc-300 dark:text-zinc-700">·</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              צפי 540 ₪
            </span>
          </p>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500">
            עוד נתונים
            <ChevronDown className="size-3.5" />
          </span>
        </div>

        <div className="mb-5 flex items-center gap-2">
          <span className="glass-inset flex items-center gap-1 rounded-full p-1">
            <span className="glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-300">
              <ChevronRight className="size-4" />
            </span>
            <span className="flex h-9 items-center rounded-full px-4 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              היום
            </span>
            <span className="glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-300">
              <ChevronLeft className="size-4" />
            </span>
          </span>
          <span className="ms-auto inline-flex h-10 items-center gap-2 rounded-full bg-zinc-950 px-4 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950">
            <Plus className="size-4" />
            תור ידני
          </span>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              היום
            </p>
            <span className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-xs font-semibold text-(--accent-on-soft) tabular-nums">
              16/9
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white tabular-nums dark:bg-zinc-100 dark:text-zinc-900">
            <CalendarCheck className="size-3.5" />7 תורים
          </span>
        </div>

        <div className="space-y-3">
          <MockAgendaRow
            start="09:00"
            end="09:30"
            name="יוסי כהן"
            status="confirmed"
            service="תספורת גבר"
            price="70 ₪"
          />
          <MockAgendaRow
            start="10:00"
            end="10:45"
            name="אורי מזרחי"
            status="pending"
            service="צבע ופן"
            price="180 ₪"
            actions="request"
          />
          <MockAgendaRow
            start="14:00"
            end="14:30"
            name="דנה לוי"
            status="confirmed"
            service="עיצוב זקן"
            price="45 ₪"
            actions="none"
          />
        </div>
      </Page>

      <MockVoiceGlow className="z-[15]" />
      <MockLibiCard
        heard="תזיזי את דנה לארבע"
        reply="מצאתי תור של דנה לוי היום ב-14:00. להזיז אותו להיום ב-16:00?"
        confirm="הזזת דנה לוי מ-14:00 ל-16:00"
        status="מקשיבה — אפשר לדבר"
      />
      <MockDock />
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The week the calendar mockup draws: Sunday to Saturday, "today" the
 * Wednesday the agenda mockup is on. The shop's hours are 09:00–19:00, Friday
 * until 14:00, Saturday closed — as `CalendarDay.open` would carry them.
 */
const WEEK_DAYS = [
  { day: "א", date: "13.9", open: [540, 1140] },
  { day: "ב", date: "14.9", open: [540, 1140] },
  { day: "ג", date: "15.9", open: [540, 1140] },
  { day: "ד", date: "16.9", open: [540, 1140], today: true },
  { day: "ה", date: "17.9", open: [540, 1140] },
  { day: "ו", date: "18.9", open: [540, 840] },
  { day: "ש", date: "19.9", open: null },
] as const;

type Sample = {
  day: number;
  /** "HH:MM". */
  at: string;
  minutes: number;
  name: string;
  state?: "pending" | "lifted";
};

/**
 * A barbershop's week — haircuts, beard trims, colour — with one request
 * waiting in amber and one booking being carried to a new time.
 */
const SAMPLES: readonly Sample[] = [
  { day: 0, at: "09:00", minutes: 30, name: "דנה לוי" },
  { day: 0, at: "09:30", minutes: 45, name: "יוסי כהן" },
  { day: 0, at: "10:30", minutes: 30, name: "אבי שמעוני" },
  { day: 0, at: "11:15", minutes: 15, name: "מאיה רז" },
  { day: 0, at: "12:00", minutes: 30, name: "רון אזולאי" },
  { day: 0, at: "13:30", minutes: 45, name: "גל פרץ" },
  { day: 1, at: "09:15", minutes: 45, name: "אורי מזרחי", state: "pending" },
  { day: 1, at: "10:30", minutes: 30, name: "מיכל אברהם" },
  { day: 1, at: "11:00", minutes: 15, name: "אלון דהן" },
  { day: 1, at: "12:30", minutes: 30, name: "הדס ביטון" },
  { day: 1, at: "14:00", minutes: 45, name: "שני גבאי" },
  { day: 2, at: "09:00", minutes: 30, name: "רונית שפירא" },
  { day: 2, at: "09:45", minutes: 30, name: "עומר לוי" },
  { day: 2, at: "10:30", minutes: 45, name: "נועה פרידמן" },
  { day: 2, at: "12:00", minutes: 30, name: "בן אוחיון" },
  { day: 2, at: "13:00", minutes: 15, name: "תמר עזרא" },
  { day: 3, at: "09:30", minutes: 30, name: "שירה נחום", state: "lifted" },
  { day: 3, at: "10:15", minutes: 30, name: "טל חדד" },
  { day: 3, at: "11:00", minutes: 45, name: "יעל שטרן" },
  { day: 3, at: "13:00", minutes: 30, name: "רועי חיים" },
  { day: 4, at: "09:00", minutes: 30, name: "גיל אלמוג" },
  { day: 4, at: "09:45", minutes: 45, name: "ליאור טל" },
  { day: 4, at: "11:00", minutes: 15, name: "עדי ברק" },
  { day: 4, at: "12:15", minutes: 30, name: "שחר גולן" },
  { day: 4, at: "13:30", minutes: 30, name: "מור אלון" },
  { day: 5, at: "09:00", minutes: 30, name: "איתי כץ" },
  { day: 5, at: "09:30", minutes: 30, name: "אלה נגר" },
  { day: 5, at: "10:15", minutes: 15, name: "נוי שלום" },
  { day: 5, at: "11:00", minutes: 45, name: "עמית רביבו" },
];

/** Where the carried booking would land: Wednesday, 12:05. */
const GHOST = { day: 3, startMinutes: 725, endMinutes: 755, name: "שירה נחום" };

function toMinutes(at: string): number {
  const [hours, minutes] = at.split(":").map(Number);
  return hours * 60 + minutes;
}

const ITEMS = SAMPLES.map((sample, index) => ({
  ...sample,
  id: String(index),
  dayIndex: sample.day,
  startMinutes: toMinutes(sample.at),
  endMinutes: toMinutes(sample.at) + sample.minutes,
}));

/**
 * **The grid, laid out by the calendar's own functions.** The compact hour
 * (`hourRowPx`), edit mode's full working day (`gridBounds` without the
 * crop), the lanes, each card's box and floor, and how many lines each card
 * has room for (`lineBudget`) — the same calls `WeekCalendar` makes, in the
 * 390px screen's own pixels, so this cannot drift from the product the way
 * a drawing would.
 */
const HOUR_PX = hourRowPx("week", "chip", null);

const BOUNDS = gridBounds(
  ITEMS,
  WEEK_DAYS.flatMap((column) =>
    column.open
      ? [{ startMinutes: column.open[0], endMinutes: column.open[1] }]
      : [],
  ),
  1,
);

const ROWS = hourRows(BOUNDS);

const LAYOUT = WEEK_DAYS.map((_, dayIndex) => {
  const placed = assignLanes(
    ITEMS.filter((item) => item.dayIndex === dayIndex),
  );
  const gaps = gapsToNext(placed);
  return placed.map((item) => {
    const toNext = gaps.get(item.id) ?? null;
    const floor = cardHeightPx(item.minutes, "week", toNext, "chip", HOUR_PX);
    return {
      item,
      style: {
        ...cardBox(placeItem(item, BOUNDS, undefined, toNext)),
        minHeight: `calc(var(--u) * ${floor})`,
      } satisfies CSSProperties,
      lines: lineBudget(floor, "week", "chip"),
    };
  });
});

/** "דנה" from "דנה לוי" — what the compact card has room for. */
function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/** One hour of grid, in the screen's own pixels. */
const hourStyle = {
  height: `calc(var(--u) * ${HOUR_PX})`,
} satisfies CSSProperties;

/**
 * **The full calendar in edit mode, on a phone.** The compact density — a
 * first name and a start time, on one line or two as the booking's height
 * allows — the violet frame and banner edit mode now wears, one request in
 * amber, and one booking being carried: faded where it was, its dashed ghost
 * where it would land. The toolbar is the real one.
 */
export function WeekScreen() {
  return (
    <>
      <Page>
        <PageTitle
          title="יומן מלא"
          subtitle="כל התורים, החסימות והצוות במקום אחד"
        />

        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            <span className="glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-300">
              <ChevronRight className="size-4" />
            </span>
            <span className="glass-control inline-flex h-9 items-center rounded-full px-4 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              השבוע
            </span>
            <span className="glass-control flex size-9 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-300">
              <ChevronLeft className="size-4" />
            </span>
          </span>
          <span className="glass-inset flex items-center gap-1 rounded-full p-1">
            <span className="flex size-9 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400">
              <Rows3 className="size-4" />
            </span>
            <span className="glass-control flex size-9 items-center justify-center rounded-full text-zinc-950 dark:text-zinc-50">
              <Columns3 className="size-4" />
            </span>
            <span className="flex size-9 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-400">
              <Grid2x2 className="size-4" />
            </span>
          </span>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="glass-inset flex items-center gap-1 rounded-full p-1">
            <span className="rounded-full px-4 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-400">
              יומי
            </span>
            <span className="glass-control rounded-full px-4 py-1.5 text-xs font-bold text-zinc-950 dark:text-zinc-50">
              שבועי
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-xs font-bold text-white shadow-[0_6px_18px_-6px_rgb(124_58_237/0.7)] dark:bg-violet-500">
              <Move className="size-4" />
              עריכה
            </span>
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-950 px-4 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950">
              <CalendarPlus className="size-4" />
              אירוע חדש
            </span>
          </span>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-violet-300/70 bg-violet-50/90 px-3.5 py-2.5 text-xs text-violet-950 shadow-[0_10px_30px_-18px_rgb(124_58_237/0.6)] dark:border-violet-400/30 dark:bg-violet-950/45 dark:text-violet-100">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500">
            <Move className="size-3.5" />
          </span>
          <p className="min-w-0 flex-1 leading-relaxed">
            <span className="font-bold">מצב עריכה פעיל.</span> גררו תור כדי
            להזיז אותו — בקפיצות של 5 דקות.
          </p>
          <span className="h-8 shrink-0 rounded-full bg-violet-600 px-3.5 text-xs leading-8 font-bold text-white dark:bg-violet-500">
            סיום
          </span>
        </div>

        <div className="glass-frame cal-editing overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div
            className="glass-header grid border-b border-zinc-200/80 dark:border-zinc-800/80"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <span />
            {WEEK_DAYS.map((column) => (
              <span
                key={column.date}
                className={cn(
                  "flex h-12 flex-col items-center justify-center",
                  "today" in column && "bg-(--accent-soft)",
                )}
              >
                <span className="mock-text-11 text-zinc-600 dark:text-zinc-400">
                  {column.day}
                </span>
                <span
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    "today" in column
                      ? "text-(--accent-on-soft)"
                      : "text-zinc-900 dark:text-zinc-100",
                  )}
                >
                  {column.date}
                </span>
              </span>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
            <div>
              {ROWS.map((hour) => (
                <div
                  key={hour}
                  style={hourStyle}
                  className="relative border-b border-zinc-100 dark:border-zinc-800/60"
                >
                  <span className="mock-text-10 absolute end-1 -top-2 text-zinc-400 tabular-nums">
                    {String(hour).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            {WEEK_DAYS.map((column, dayIndex) => (
              <div
                key={column.date}
                className={cn(
                  "relative border-s border-zinc-100 dark:border-zinc-800/60",
                  "today" in column && "bg-(--accent-soft)/40",
                )}
              >
                {ROWS.map((hour) => (
                  <div
                    key={hour}
                    style={hourStyle}
                    className="border-b border-zinc-100 dark:border-zinc-800/60"
                  />
                ))}

                {column.open ? (
                  <div
                    className="absolute inset-x-0 bg-zinc-50 dark:bg-zinc-800/30"
                    style={openBand(column.open)}
                  />
                ) : null}

                <div className="cal-edit-canvas mock-canvas absolute inset-0" />

                {LAYOUT[dayIndex].map(({ item, style, lines }) => (
                  <span
                    key={item.id}
                    style={style}
                    className={cn(
                      "absolute flex overflow-hidden rounded-lg border text-start backdrop-blur-sm",
                      "cal-glass mock-card-type text-zinc-900 dark:text-zinc-50",
                      item.state === "pending" && "cal-pending",
                      item.state === "lifted" && "opacity-35",
                    )}
                  >
                    <span
                      className={cn(
                        "flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-1",
                        lines <= 1 ? "py-0" : "py-0.5",
                      )}
                    >
                      {lines <= 1 ? (
                        <span className="flex h-3.5 shrink-0 flex-wrap items-center gap-x-1 overflow-hidden">
                          <span className="max-w-full min-w-0 truncate font-bold">
                            {firstName(item.name)}
                          </span>
                          <span className="shrink-0 tabular-nums opacity-75">
                            {item.at}
                          </span>
                        </span>
                      ) : (
                        <>
                          <span className="flex h-3.5 shrink-0 items-center gap-1">
                            <span className="min-w-0 flex-1 truncate font-bold">
                              {firstName(item.name)}
                            </span>
                          </span>
                          <span className="flex h-3.5 shrink-0 items-center gap-0.5">
                            <span className="min-w-0 truncate tabular-nums opacity-75">
                              {item.at}
                            </span>
                          </span>
                        </>
                      )}
                    </span>
                    {item.state === "pending" ? (
                      <span className="absolute end-1 top-1 size-1.5 rounded-full bg-amber-600 ring-1 ring-white/80 dark:ring-zinc-950/70" />
                    ) : null}
                  </span>
                ))}

                {dayIndex === GHOST.day ? (
                  /* The booking being carried: where it would land. */
                  <span
                    style={cardBox(
                      placeItem(
                        {
                          id: "ghost",
                          dayIndex,
                          startMinutes: GHOST.startMinutes,
                          endMinutes: GHOST.endMinutes,
                          lane: 0,
                          lanes: 1,
                        },
                        BOUNDS,
                      ),
                    )}
                    className="absolute z-30 flex min-h-7 flex-col justify-start overflow-hidden rounded-lg border-2 border-dashed border-zinc-900/70 bg-white/85 px-1 py-0.5 text-zinc-900 shadow-lg backdrop-blur-sm dark:border-zinc-100/70 dark:bg-zinc-900/85 dark:text-zinc-50"
                  >
                    <span
                      dir="ltr"
                      className="mock-card-type truncate font-bold tabular-nums"
                    >
                      {minutesToLabel(GHOST.startMinutes)}
                    </span>
                    <span className="mock-text-10 truncate font-medium opacity-90">
                      {firstName(GHOST.name)}
                    </span>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </Page>
      <MockDock />
    </>
  );
}

/** The rail, then seven equal days — the grid template the calendar builds. */
const GRID_TEMPLATE = `calc(var(--u) * 48) repeat(${WEEK_DAYS.length}, minmax(0, 1fr))`;

/** The open-hours band behind a day's cards, placed as the calendar places it. */
function openBand(open: readonly [number, number]): CSSProperties {
  const box = placeItem(
    {
      id: "",
      dayIndex: 0,
      startMinutes: open[0],
      endMinutes: open[1],
      lane: 0,
      lanes: 1,
    },
    BOUNDS,
  );
  return { top: `${box.top}%`, height: `${box.height}%` };
}

/* -------------------------------------------------------------------------- */

/**
 * **Requests waiting on the owner.** The amber panel the agenda opens with
 * when a service takes approval: two requests, each already holding its slot,
 * each a tap from confirmed or declined.
 */
export function RequestsScreen() {
  return (
    <>
      <Page>
        <AgendaHeader />

        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
              <Hourglass className="size-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                2 בקשות ממתינות לאישורכם
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/70">
                המועד שמור ללקוח עד שתחליטו.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <MockAgendaRow
              start="11:00"
              end="12:30"
              name="מיכל אברהם"
              status="pending"
              service="החלקה"
              price="450 ₪"
              actions="request"
            />
            <MockAgendaRow
              start="16:30"
              end="17:30"
              name="נועה פרץ"
              status="pending"
              service="צבע ופן"
              price="180 ₪"
              actions="request"
            />
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            היום
          </p>
          <span className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-xs font-semibold text-(--accent-on-soft) tabular-nums">
            16/9
          </span>
        </div>
        <div className="space-y-3">
          <MockAgendaRow
            start="09:00"
            end="09:30"
            name="יוסי כהן"
            status="confirmed"
            service="תספורת גבר"
            price="70 ₪"
          />
          <MockAgendaRow
            start="12:00"
            end="12:45"
            name="רונית שפירא"
            status="confirmed"
            service="תספורת נשים"
            price="120 ₪"
          />
        </div>
      </Page>
      <MockDock />
    </>
  );
}

/* -------------------------------------------------------------------------- */

const CLIENTS = [
  {
    name: "דנה לוי",
    visits: "9 תורים",
    last: "אחרון לפני שבוע",
    note: true,
  },
  {
    name: "יוסי כהן",
    visits: "14 תורים",
    last: "אחרון היום",
  },
  {
    name: "אורי מזרחי",
    visits: "3 תורים",
    last: "אחרון לפני 3 שבועות",
  },
  {
    name: "מיכל אברהם",
    visits: "6 תורים",
    last: "אחרון לפני חודש",
    note: true,
  },
  {
    name: "רונית שפירא",
    visits: "11 תורים",
    last: "אחרון לפני 5 ימים",
  },
  {
    name: "טל ביטון",
    visits: "8 תורים",
    last: "אחרון לפני 10 ימים",
  },
  {
    name: "עומר לוי",
    visits: "2 תורים",
    last: "אחרון לפני חודשיים",
  },
] as const;

/**
 * **The clients, built from the bookings.** Search, the count, and a row per
 * person — visits, the last one, and the call and WhatsApp a tap away; the
 * amber note mark on the ones the shop has written something about. No phone
 * numbers: a plausible one on a marketing page is somebody's real one.
 */
export function ClientsScreen() {
  return (
    <>
      <Page>
        <PageTitle title="לקוחות" subtitle="כל מי שקבע אצלכם תור, במקום אחד" />

        <div className="relative mb-4">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <div className="flex h-11 w-full items-center rounded-xl border border-zinc-200 bg-white ps-9 text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
            חיפוש לפי שם או טלפון
          </div>
        </div>
        <p className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500">
          <Users className="size-3.5" />
          38 לקוחות
        </p>

        <div className="space-y-2">
          {CLIENTS.map((client) => (
            <div
              key={client.name}
              className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                    <span className="truncate">{client.name}</span>
                    {"note" in client ? (
                      <StickyNote className="size-3.5 shrink-0 text-amber-500" />
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {client.visits} · {client.last}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                    <Phone className="size-4" />
                  </span>
                  <span className="inline-flex size-9 items-center justify-center rounded-lg border border-zinc-200 text-emerald-700 dark:border-zinc-700 dark:text-emerald-300">
                    <MessageCircle className="size-4" />
                  </span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </Page>
      <MockDock active={3} />
    </>
  );
}
