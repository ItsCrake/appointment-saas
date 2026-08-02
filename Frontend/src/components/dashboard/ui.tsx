import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared dashboard chrome. One definition per control so the teal accent, the
 * focus ring and the disabled treatment cannot drift between the six screens —
 * which is exactly what happened when each manager styled its own buttons.
 *
 * teal-700, never teal-600: white on teal-600 measures 3.67:1 and fails WCAG
 * AA, teal-700 measures 5.36:1. Same rule as the marketing surface.
 */

export const btnPrimary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-800 hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100";

export const btnSecondary =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-300 px-4 text-sm font-semibold text-neutral-700 transition-colors hover:border-teal-700 hover:text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-teal-300";

export const btnDanger =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:outline-none disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40";

export const inputClass =
  "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:ring-2 focus:ring-teal-700 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100";

export const cardClass =
  "rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900";

/* -------------------------------------------------------------------------- */

export type AppointmentStatusName =
  "pending" | "confirmed" | "completed" | "no_show" | "cancelled";

export const STATUS_LABEL: Record<AppointmentStatusName, string> = {
  pending: "ממתין",
  confirmed: "מאושר",
  completed: "הושלם",
  no_show: "לא הגיע",
  cancelled: "בוטל",
};

/**
 * Status colour is load-bearing information, so it never relies on hue alone —
 * the label is always present next to it.
 */
const STATUS_STYLE: Record<AppointmentStatusName, string> = {
  confirmed:
    "bg-teal-100 text-teal-800 ring-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:ring-teal-900",
  pending:
    "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  cancelled:
    "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
  no_show:
    "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  completed:
    "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
};

export function StatusChip({ status }: { status: string }) {
  const key = (
    status in STATUS_STYLE ? status : "pending"
  ) as AppointmentStatusName;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        STATUS_STYLE[key],
      )}
    >
      {STATUS_LABEL[key]}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-5 py-12 text-center dark:border-neutral-700">
      <div
        aria-hidden
        className="mb-1 flex size-11 items-center justify-center rounded-full bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {title}
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-neutral-500">
        {body}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Mirrors the shape of what is loading, so nothing jumps when it arrives. */
export function SkeletonRows({
  rows = 3,
  height = "h-24",
}: {
  rows?: number;
  height?: string;
}) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("animate-shimmer rounded-2xl", height)} />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
