import type { CSSProperties, ReactNode } from "react";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FoldVertical,
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
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
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

/** The week's columns: weekday letter and date, Sunday to Friday. */
const WEEK_DAYS = [
  { day: "א", date: "13.9" },
  { day: "ב", date: "14.9" },
  { day: "ג", date: "15.9" },
  { day: "ד", date: "16.9", today: true },
  { day: "ה", date: "17.9" },
  { day: "ו", date: "18.9" },
] as const;

/** First hour drawn, and how many. */
const GRID_START = 9;
const GRID_HOURS = 7;

type Chip = {
  day: number;
  /** Minutes past 09:00. */
  at: number;
  /** Minutes long. */
  length: number;
  name: string;
  time: string;
  state?: "pending" | "muted" | "selected" | "lifted";
};

/** Sample bookings, in compact density — a first name and a start time. */
const CHIPS: readonly Chip[] = [
  { day: 0, at: 0, length: 30, name: "דנה", time: "09:00" },
  { day: 0, at: 60, length: 45, name: "יוסי", time: "10:00" },
  { day: 0, at: 150, length: 30, name: "אבי", time: "11:30" },
  { day: 1, at: 30, length: 45, name: "אורי", time: "09:30", state: "pending" },
  { day: 1, at: 120, length: 30, name: "מיכל", time: "11:00" },
  { day: 2, at: 0, length: 30, name: "רונית", time: "09:00" },
  { day: 2, at: 75, length: 30, name: "עומר", time: "10:15" },
  { day: 2, at: 180, length: 45, name: "נועה", time: "12:00" },
  { day: 3, at: 60, length: 30, name: "שירה", time: "10:00", state: "lifted" },
  { day: 3, at: 150, length: 30, name: "טל", time: "11:30", state: "muted" },
  { day: 4, at: 45, length: 30, name: "גיל", time: "09:45", state: "selected" },
  { day: 4, at: 135, length: 45, name: "ליאור", time: "11:15" },
  { day: 5, at: 0, length: 30, name: "עדי", time: "09:00" },
  { day: 0, at: 270, length: 45, name: "מאיה", time: "13:30" },
  { day: 1, at: 240, length: 30, name: "אלון", time: "13:00" },
  { day: 1, at: 330, length: 45, name: "הדס", time: "14:30" },
  { day: 2, at: 300, length: 30, name: "בן", time: "14:00" },
  { day: 3, at: 240, length: 45, name: "יעל", time: "13:00" },
  { day: 4, at: 285, length: 30, name: "רועי", time: "13:45" },
  { day: 5, at: 90, length: 30, name: "שחר", time: "10:30" },
];

/** Where a chip sits: percentages of the grid, as `placeItem` would put it. */
function chipBox(at: number, length: number): CSSProperties {
  const span = GRID_HOURS * 60;
  return {
    top: `${(at / span) * 100}%`,
    height: `${(length / span) * 100}%`,
  };
}

/**
 * **The full calendar in edit mode.** A week in compact density, one request
 * waiting in amber, one booking picked for a swap, and one being carried to a
 * new time — its ghost dashed where it would land, the card itself faded
 * where it was. The toolbar and the hint are the real ones.
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
          <span className="flex items-center gap-2">
            <span className="glass-inset flex items-center rounded-full p-1 text-zinc-600 dark:text-zinc-400">
              <span className="flex size-9 items-center justify-center rounded-full">
                <FoldVertical className="size-4" />
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
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-900 px-4 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
              <Move className="size-4" />
              עריכה
            </span>
            <span className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-950 px-4 text-xs font-semibold text-white dark:bg-zinc-50 dark:text-zinc-950">
              <CalendarPlus className="size-4" />
              אירוע חדש
            </span>
          </span>
        </div>

        <div className="glass-inset mb-3 flex items-center gap-3 rounded-2xl px-3.5 py-2.5">
          <Move className="size-4 shrink-0 text-zinc-500" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              מצב עריכה.
            </span>{" "}
            גררו תור כדי להזיז אותו — בקפיצות של 5 דקות.
          </p>
          <span className="h-8 shrink-0 rounded-full bg-zinc-900 px-3.5 text-xs leading-8 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
            סיום
          </span>
        </div>

        <div className="glass-frame overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="glass-header grid grid-cols-[2.5rem_repeat(6,minmax(0,1fr))] border-b border-zinc-200/80 dark:border-zinc-800/80">
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

          <div className="grid h-[28rem] grid-cols-[2.5rem_repeat(6,minmax(0,1fr))]">
            <div className="grid grid-rows-7">
              {Array.from({ length: GRID_HOURS }, (_, hour) => (
                <span
                  key={hour}
                  className="mock-text-10 relative border-b border-zinc-100 pe-1 text-end text-zinc-400 tabular-nums dark:border-zinc-800/60"
                >
                  {String(GRID_START + hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {WEEK_DAYS.map((column, dayIndex) => (
              <div
                key={column.date}
                className={cn(
                  "relative grid grid-rows-7 border-s border-zinc-100 dark:border-zinc-800/60",
                  "today" in column && "bg-(--accent-soft)/40",
                )}
              >
                {Array.from({ length: GRID_HOURS }, (_, hour) => (
                  <span
                    key={hour}
                    className="border-b border-zinc-100 dark:border-zinc-800/60"
                  />
                ))}
                {CHIPS.filter((chip) => chip.day === dayIndex).map((chip) => (
                  <span
                    key={`${chip.day}-${chip.at}`}
                    style={chipBox(chip.at, chip.length)}
                    className={cn(
                      "absolute inset-x-0.5 flex flex-col justify-center overflow-hidden rounded-lg border px-1 backdrop-blur-sm",
                      "cal-glass text-zinc-900 dark:text-zinc-50",
                      chip.state === "pending" && "cal-pending",
                      chip.state === "muted" &&
                        "cal-muted text-zinc-600 dark:text-zinc-400",
                      chip.state === "selected" &&
                        "z-10 ring-2 ring-zinc-900 ring-offset-1 ring-offset-white dark:ring-zinc-100 dark:ring-offset-zinc-950",
                      chip.state === "lifted" && "opacity-35",
                    )}
                  >
                    <span className="mock-text-10 truncate font-bold">
                      {chip.name}
                    </span>
                    <span className="mock-text-10 truncate tabular-nums opacity-75">
                      {chip.time}
                    </span>
                  </span>
                ))}
                {dayIndex === 3 ? (
                  /* The booking being carried: where it would land. */
                  <span
                    style={chipBox(185, 30)}
                    className="absolute inset-x-0.5 z-20 flex flex-col justify-center overflow-hidden rounded-lg border-2 border-dashed border-zinc-900/70 bg-white/85 px-1 text-zinc-900 shadow-lg dark:border-zinc-100/70 dark:bg-zinc-900/85 dark:text-zinc-50"
                  >
                    <span className="mock-text-10 truncate font-bold tabular-nums">
                      12:05
                    </span>
                    <span className="mock-text-10 truncate opacity-90">שירה</span>
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
