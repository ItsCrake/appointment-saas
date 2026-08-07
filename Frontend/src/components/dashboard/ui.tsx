import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared app chrome. One definition per control so the palette, the focus ring
 * and the disabled treatment cannot drift between screens — which is exactly
 * what happened when each manager styled its own buttons.
 *
 * ---------------------------------------------------------------------------
 * THE PALETTE IS THE LANDING PAGE'S, AND THAT IS THE WHOLE POINT.
 *
 * `/` was rebuilt monochrome while `/login`, `/dashboard/*` and `/master` kept
 * a teal chrome, so a visitor who signed up walked from one product into
 * another. There is no teal anywhere now: ink is `zinc-950`, paper is white,
 * and the `zinc-200..600` ramp carries everything between.
 *
 * **In a system with no accent hue, contrast is the accent.** Every primary
 * action is therefore solid ink on paper and inverts wholesale in dark mode,
 * rather than being a coloured button.
 *
 * `--brand-gradient` is the one exception and is spent only where the landing
 * page spends it — on something *active* or *recommended*: the current nav
 * item, the selected plan, the upgrade path. A gradient used for decoration is
 * what turns an accent into a theme.
 *
 * SHAPE, following the same scale as `/`: pill for anything interactive,
 * `rounded-2xl` for a card sitting inside a page. Text inputs are the one
 * documented departure — they stay `rounded-xl`, because a pill field wastes
 * its horizontal ends and, in RTL, drops the caret against a curve. A button
 * is a target; a field is a container for content.
 * ---------------------------------------------------------------------------
 */

/** The gradient fill, matching the recommended tier's action on `/`. */
export const brandGradient = "bg-[image:var(--brand-gradient)]";

const focusRing =
  "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white";

/** Offset rings need a matching offset colour or they halo white on ink. */
const focusRingOffset =
  "focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950";

export const btnPrimary = cn(
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition-all hover:bg-zinc-800 active:translate-y-px disabled:opacity-60 disabled:active:translate-y-0",
  "dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200",
  focusRing,
  focusRingOffset,
);

/**
 * For the one action on a screen that is being *recommended* rather than
 * merely available — starting a trial, upgrading a plan. Never for save.
 */
export const btnAccent = cn(
  "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:translate-y-px disabled:opacity-60",
  brandGradient,
  "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
  focusRingOffset,
);

export const btnSecondary = cn(
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 text-sm font-semibold text-zinc-950 transition-colors hover:border-zinc-950 hover:bg-zinc-50 disabled:opacity-60",
  "dark:border-zinc-700 dark:text-zinc-50 dark:hover:border-zinc-100 dark:hover:bg-zinc-900",
  focusRing,
);

export const btnDanger =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-red-200 px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:outline-none disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40";

export const inputClass =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-transparent focus:ring-2 focus:ring-zinc-950 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-white";

export const cardClass =
  "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

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
 *
 * These four hues survive the monochrome pass deliberately. They are
 * *semantic*, not brand: amber-for-waiting and rose-for-cancelled are read
 * without a legend, and flattening them to grey would delete information from
 * the one screen an owner scans fastest. Only `confirmed` moved — from teal to
 * indigo, the gradient's mid stop — because a confirmed appointment is the
 * "active" thing in the list, which is exactly what the brand ramp is for on
 * `/`. That also removes the last teal from the product.
 */
const STATUS_STYLE: Record<AppointmentStatusName, string> = {
  confirmed:
    "bg-indigo-100 text-indigo-800 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-900",
  pending:
    "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  cancelled:
    "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
  no_show:
    "bg-zinc-200 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
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
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-5 py-12 text-center dark:border-zinc-700">
      <div
        aria-hidden
        className="mb-1 flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        {title}
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">{body}</p>
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
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
