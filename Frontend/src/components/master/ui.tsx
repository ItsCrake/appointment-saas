import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Console chrome. Dark by construction rather than via `dark:` variants —
 * `/master` is always dark regardless of the viewer's system preference, so
 * pairing every colour would be noise.
 *
 * The ink is now `zinc-950`, the same value the landing hero's dark panel uses,
 * rather than the slate it was built on. `/master` is the one surface in the
 * product that was *already* a dark monochrome page; matching the ramp is most
 * of what it needed, and the teal accents become the brand gradient.
 */

export const panel =
  "rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur";

export const masterInput =
  "h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-transparent focus:ring-2 focus:ring-white focus:outline-none";

export const masterBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-zinc-700 px-3.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-100 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-50";

/**
 * Sized to match `masterBtn` so the plan control sits level with the buttons it
 * lives beside.
 *
 * The **native** appearance is kept deliberately: `appearance-none` would strip
 * the disclosure arrow, and in a row of pill buttons a select with no arrow
 * reads as just another button — one whose behaviour on click is a surprise.
 * The browser also puts that arrow on the correct side under RTL by itself.
 */
export const masterSelect =
  "h-9 rounded-full border border-zinc-700 bg-zinc-950 px-3 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-50";

export const masterBtnDanger =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-rose-900 px-3.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-950/50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none disabled:opacity-50";

export function MetricCard({
  icon,
  label,
  value,
  hint,
  tone = "plain",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  /** `brand` is the money metric; `warn` is the one that needs attention. */
  tone?: "plain" | "brand" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "brand"
          ? "border-indigo-900 bg-indigo-950/40"
          : tone === "warn"
            ? "border-amber-900 bg-amber-950/30"
            : "border-zinc-800 bg-zinc-900/60",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "brand"
            ? "text-indigo-300"
            : tone === "warn"
              ? "text-amber-300"
              : "text-zinc-400",
        )}
      >
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl leading-none font-bold text-zinc-50 tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}

const TENANT_TONE = {
  // Indigo is the gradient's mid stop: a paying tenant is the "active" state
  // this console exists to count, so it carries the brand hue.
  active: "bg-indigo-950 text-indigo-300 ring-indigo-900",
  trialing: "bg-amber-950 text-amber-300 ring-amber-900",
  frozen: "bg-zinc-800 text-zinc-400 ring-zinc-700",
  cancelled: "bg-rose-950 text-rose-300 ring-rose-900",
} as const;

const TENANT_LABEL = {
  active: "פעיל",
  trialing: "בניסיון",
  frozen: "מוקפא",
  cancelled: "בוטל",
} as const;

export type TenantState = keyof typeof TENANT_TONE;

/** Freeze outranks the subscription: a frozen tenant is serving nobody. */
export function tenantState(
  isActive: boolean,
  subscriptionStatus: string,
): TenantState {
  if (!isActive) return "frozen";
  if (subscriptionStatus === "active") return "active";
  if (subscriptionStatus === "cancelled") return "cancelled";
  return "trialing";
}

export function TenantPill({ state }: { state: TenantState }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        TENANT_TONE[state],
      )}
    >
      {TENANT_LABEL[state]}
    </span>
  );
}

export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 px-5 py-12 text-center">
      <p className="text-sm font-semibold text-zinc-300">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
        {body}
      </p>
    </div>
  );
}
