import type { ReactNode } from "react";
import { StickyNote } from "lucide-react";

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
 * **Two derived treatments extend that rule rather than break it**, and both
 * live in `globals.css`: `brand-tint` is the ramp at about a sixth strength and
 * `brand-rule` is a hairline that fades out. They mark *page identity* on the
 * management screens — see `PageHeader` — and they are deliberately weak enough
 * that neither can be confused with the solid gradient's "press this" meaning.
 * The full-strength ramp is still reserved for active and recommended.
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

/**
 * The heading every management screen shares.
 *
 * ---------------------------------------------------------------------------
 * `icon` is what tells the three flattest screens in the product apart. Services,
 * hours and clients are otherwise a heading over a list, and an owner two taps
 * deep could not tell at a glance which one they had landed on — they each
 * hand-rolled their own `<h1>` at a different type scale, which made it worse.
 *
 * The container is `brand-tint`: the brand ramp at about a sixth of its
 * strength. Deliberately not the solid gradient, which means "active or
 * recommended" and is already spent on the current nav item a few inches away —
 * see the note at the top of this file. A tint reads as the page's own colour
 * instead of as something to press.
 *
 * The rule beneath it fades out across the page rather than running edge to
 * edge, because a full-width line at full strength is a divider and this is a
 * signature.
 * ---------------------------------------------------------------------------
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <span
              aria-hidden
              className="brand-tint flex size-10 shrink-0 items-center justify-center rounded-2xl text-indigo-700 ring-1 ring-indigo-500/15 dark:text-indigo-200 dark:ring-indigo-400/20"
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {icon ? <div aria-hidden className="brand-rule mt-4 h-0.5" /> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A proportion, drawn.
 *
 * Lives here rather than beside the analytics panels because two of them use it
 * and one is now a client component — a shared primitive in a module both sides
 * already import, instead of dragging the whole panels file into the browser
 * bundle to reach twelve lines of markup.
 *
 * The floor of 2% is so a service with a single booking still shows *something*:
 * a bar rounded to zero reads as "no data" rather than as "not much".
 */
export function Bar({ value, max }: { value: number; max: number }) {
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

/* -------------------------------------------------------------------------- */

/**
 * "There are notes" — shown **only** when a client actually left some.
 *
 * The absence is the design. A badge that renders "no notes" on every
 * appointment trains an owner to stop reading badges, and the one booking that
 * says "I'm bringing my son too" then looks exactly like the ninety that say
 * nothing. Rendering nothing at all is what keeps the badge worth noticing.
 *
 * It is a flag, not the content: the note itself is a sentence someone typed
 * and belongs where there is room to read it, which is the agenda row and the
 * calendar's hover card. Here it only says *look*.
 */
export function NotesBadge({ notes }: { notes: string | null | undefined }) {
  if (!notes?.trim()) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 ring-inset dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
      <StickyNote className="size-3" aria-hidden />
      ישנן הערות
    </span>
  );
}
