import Link from "next/link";

import type {
  Granularity,
  ServiceBreakdown,
  StaffLoad,
  TrendPoint,
} from "@/db/queries/analytics";
import {
  ANALYTICS_RANGES,
  periodLabel,
  RANGE_LABELS,
  rate,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
  type AnalyticsRange,
  type HeatGrid,
  type StatusSummary,
} from "@/lib/analytics";
import { formatPrice } from "@/lib/format";
import { staffSwatch } from "@/lib/staff-colors";
import { cn } from "@/lib/utils";

import { cardClass, EmptyState } from "./ui";

/**
 * Every panel on `/dashboard/analytics`, server-rendered.
 *
 * ---------------------------------------------------------------------------
 * No charting library, for the same reason there is no component library: a
 * bar is a div with a width and a heatmap is a grid with background colours.
 * Pulling 40KB of JavaScript into a dashboard that runs on a phone, to draw
 * rectangles, is a trade nobody here would make twice.
 *
 * Nothing on this page is a client component. The range and sort controls are
 * links that change `searchParams`, so the whole thing works as fast as the
 * server can answer and costs the browser nothing.
 *
 * Colour is used **only where it is data**: heat intensity and a provider's own
 * calendar swatch. The chrome stays on the monochrome ramp, which is what makes
 * the coloured parts read as meaning rather than decoration.
 * ---------------------------------------------------------------------------
 */

export function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(cardClass, "p-4 sm:p-5")}>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      {hint ? (
        <p className="mt-0.5 mb-4 text-xs text-zinc-500">{hint}</p>
      ) : null}
      {hint ? null : <div className="mb-4" />}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/** Links, not buttons: the range is a URL, so it survives a refresh and a share. */
export function RangeTabs({
  current,
  sort,
}: {
  current: AnalyticsRange;
  sort: string;
}) {
  return (
    <div
      role="group"
      aria-label="טווח זמן"
      className="inline-flex rounded-full border border-zinc-200 p-1 dark:border-zinc-800"
    >
      {ANALYTICS_RANGES.map((range) => (
        <Link
          key={range}
          href={`/dashboard/analytics?range=${range}&by=${sort}`}
          aria-current={range === current ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
            range === current
              ? "bg-[image:var(--brand-gradient)] text-white"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
          )}
        >
          {RANGE_LABELS[range]}
        </Link>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function HeadlineCards({
  bookings,
  revenueCents,
  busyDay,
  busyHour,
}: {
  bookings: number;
  revenueCents: number;
  busyDay: number | null;
  busyHour: number | null;
}) {
  const cards = [
    { label: "תורים", value: String(bookings) },
    // "Expected" is load-bearing: nothing here has been collected, and the
    // whole platform is careful never to imply otherwise.
    { label: "הכנסה צפויה", value: formatPrice(revenueCents) },
    {
      label: "היום העמוס",
      value: busyDay === null ? "—" : WEEKDAY_FULL[busyDay],
    },
    {
      label: "השעה העמוסה",
      value:
        busyHour === null ? "—" : `${String(busyHour).padStart(2, "0")}:00`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={cn(cardClass, "p-4")}>
          <p className="text-xs text-zinc-500">{card.label}</p>
          <p className="mt-1 truncate text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Five steps rather than a continuous ramp.
 *
 * A smooth gradient looks better and reads worse: nobody can tell 60% from 70%
 * of a colour, and the question a heatmap answers is "which cells are the busy
 * ones", not "exactly how busy". Discrete bands make that legible at a glance
 * and survive being looked at on a phone in daylight.
 */
const HEAT_STEPS = [
  "rgb(238 242 255)", // indigo-50
  "rgb(199 210 254)", // indigo-200
  "rgb(129 140 248)", // indigo-400
  "rgb(79 70 229)", // indigo-600
  "rgb(55 48 163)", // indigo-800
];

function heatColour(value: number, max: number): string | undefined {
  if (value <= 0) return undefined;
  const step = Math.min(
    HEAT_STEPS.length - 1,
    Math.floor(((value - 1) / Math.max(1, max)) * HEAT_STEPS.length),
  );
  return HEAT_STEPS[step];
}

export function Heatmap({ grid }: { grid: HeatGrid }) {
  if (grid.hours.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>◲</span>}
        title="אין עדיין מספיק נתונים"
        body="אחרי כמה תורים נראה כאן באילו ימים ושעות העסק הכי עמוס."
      />
    );
  }

  return (
    // Scrolls inside itself rather than pushing the page sideways — a shop open
    // fourteen hours cannot fit on a phone at a legible cell size.
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <table className="w-full min-w-[22rem] border-separate border-spacing-1">
        <caption className="sr-only">מספר התורים לפי יום בשבוע ושעה</caption>
        <thead>
          <tr>
            <th className="w-6" />
            {grid.hours.map((hour) => (
              <th
                key={hour}
                scope="col"
                className="text-[10px] font-medium text-zinc-400 tabular-nums"
              >
                {hour}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.weekday}>
              <th
                scope="row"
                className="w-6 text-[11px] font-semibold text-zinc-500"
              >
                {WEEKDAY_LABELS[row.weekday]}
              </th>
              {row.cells.map((value, index) => (
                <td
                  key={grid.hours[index]}
                  // The number is in the label, not the cell: at this size a
                  // digit is unreadable, and the colour is the message.
                  title={`${WEEKDAY_FULL[row.weekday]} ${grid.hours[index]}:00 — ${value} תורים`}
                  className={cn(
                    "h-7 rounded-md text-center align-middle",
                    value === 0 && "bg-zinc-100 dark:bg-zinc-800/60",
                  )}
                  style={{ backgroundColor: heatColour(value, grid.max) }}
                >
                  <span className="sr-only">
                    {WEEKDAY_FULL[row.weekday]} {grid.hours[index]}:00 — {value}{" "}
                    תורים
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function StatusPanel({ summary }: { summary: StatusSummary }) {
  if (summary.total === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>◔</span>}
        title="אין תורים בטווח הזה"
        body="בחרו טווח ארוך יותר, או חזרו אחרי שיתקבלו תורים."
      />
    );
  }

  const rows = [
    {
      label: "הושלמו",
      value: summary.completed,
      bar: "bg-emerald-500",
      tone: "text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "פעילים או ממתינים",
      value: summary.upcoming,
      bar: "bg-indigo-500",
      tone: "text-indigo-700 dark:text-indigo-300",
    },
    {
      label: "בוטלו",
      value: summary.cancelled,
      bar: "bg-rose-500",
      tone: "text-rose-700 dark:text-rose-300",
    },
    {
      label: "לא הגיעו",
      value: summary.noShow,
      bar: "bg-zinc-400",
      tone: "text-zinc-600 dark:text-zinc-400",
    },
  ];

  return (
    <div>
      {/* One stacked bar first, because the shape of the split is the answer;
          the numbers below are for the person who wants the detail. */}
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {rows.map((row) =>
          row.value > 0 ? (
            <div
              key={row.label}
              className={row.bar}
              style={{ width: `${rate(row.value, summary.total)}%` }}
              aria-hidden
            />
          ) : null,
        )}
      </div>

      <dl className="mt-4 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-sm">
            <span className={cn("size-2.5 shrink-0 rounded-full", row.bar)} />
            <dt className="flex-1 text-zinc-600 dark:text-zinc-400">
              {row.label}
            </dt>
            <dd className={cn("font-semibold tabular-nums", row.tone)}>
              {row.value}
              <span className="ms-1.5 text-xs font-normal text-zinc-400">
                {rate(row.value, summary.total)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export type SortKey = "bookings" | "revenue";

export function ServicesPanel({
  services,
  sort,
  range,
}: {
  services: ServiceBreakdown[];
  sort: SortKey;
  range: AnalyticsRange;
}) {
  if (services.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>☰</span>}
        title="אין נתונים על שירותים"
        body="ברגע שיתקבלו תורים נראה כאן מה הכי מבוקש ומה מכניס הכי הרבה."
      />
    );
  }

  // Sorted here rather than in SQL: the same rows answer both questions, and a
  // second round trip to reorder eight items would be absurd.
  const sorted = [...services].sort((a, b) =>
    sort === "revenue"
      ? b.revenueCents - a.revenueCents
      : b.bookings - a.bookings,
  );
  const top = sorted.slice(0, 8);
  const max = Math.max(
    ...top.map((row) => (sort === "revenue" ? row.revenueCents : row.bookings)),
    1,
  );

  return (
    <div>
      <div
        role="group"
        aria-label="מיון"
        className="mb-4 inline-flex rounded-full border border-zinc-200 p-1 dark:border-zinc-800"
      >
        {(
          [
            ["bookings", "הכי מבוקשים"],
            ["revenue", "הכי רווחיים"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/dashboard/analytics?range=${range}&by=${key}`}
            aria-current={key === sort ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              key === sort
                ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <ul className="space-y-3">
        {top.map((row) => {
          const value = sort === "revenue" ? row.revenueCents : row.bookings;
          return (
            <li key={row.serviceName}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {row.serviceName}
                </span>
                <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                  {row.bookings} תורים · {formatPrice(row.revenueCents)}
                </span>
              </div>
              <Bar value={value} max={max} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function StaffPanel({ staff }: { staff: StaffLoad[] }) {
  if (staff.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>☺</span>}
        title="אין נתונים על הצוות"
        body="נראה כאן איך התורים מתחלקים בין נותני השירות."
      />
    );
  }

  const total = staff.reduce((sum, row) => sum + row.bookings, 0);
  const max = Math.max(...staff.map((row) => row.bookings), 1);

  return (
    <ul className="space-y-3">
      {staff.map((row) => (
        <li key={row.staffId}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              {/* Their own calendar swatch, so the chart and the agenda name
                  the same person the same way. */}
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  staffSwatch(row.color).dot,
                )}
              />
              <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {row.staffName}
              </span>
            </span>
            <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
              {row.bookings} · {rate(row.bookings, total)}%
            </span>
          </div>
          <Bar value={row.bookings} max={max} />
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

export function TrendPanel({
  points,
  granularity,
}: {
  points: TrendPoint[];
  granularity: Granularity;
}) {
  if (points.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>↗</span>}
        title="אין עדיין מגמה להראות"
        body="נראה כאן כמה תורים והכנסה צפויה בכל שבוע."
      />
    );
  }

  const max = Math.max(...points.map((point) => point.bookings), 1);

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <ul
        className="flex min-w-full items-end gap-2"
        style={{ minHeight: "9rem" }}
      >
        {points.map((point) => (
          <li
            key={point.period}
            className="flex min-w-9 flex-1 flex-col items-center gap-1.5"
            title={`${periodLabel(point.period, granularity)} — ${point.bookings} תורים · ${formatPrice(point.revenueCents)}`}
          >
            <span className="text-[10px] font-semibold text-zinc-500 tabular-nums">
              {point.bookings}
            </span>
            <span
              className="w-full rounded-t-md bg-[image:var(--brand-gradient)]"
              // Floored so a bucket with a single booking is still a visible
              // bar rather than a line nobody can hover.
              style={{
                height: `${Math.max(4, Math.round((point.bookings / max) * 100))}%`,
                minHeight: "0.5rem",
              }}
              aria-hidden
            />
            <span className="text-[10px] whitespace-nowrap text-zinc-400">
              {periodLabel(point.period, granularity)}
            </span>
            <span className="sr-only">
              {point.bookings} תורים, {formatPrice(point.revenueCents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className="h-full rounded-full bg-[image:var(--brand-gradient)]"
        style={{ width: `${Math.max(2, Math.round((value / max) * 100))}%` }}
        aria-hidden
      />
    </div>
  );
}
