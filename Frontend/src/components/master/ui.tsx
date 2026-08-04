import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Console chrome. Dark by construction rather than via `dark:` variants —
 * `/master` is always dark regardless of the viewer's system preference, so
 * pairing every colour would be noise.
 */

export const panel =
  "rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur";

export const masterInput =
  "h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-transparent focus:ring-2 focus:ring-teal-500 focus:outline-none";

export const masterBtn =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-500 hover:text-teal-300 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none disabled:opacity-50";

export const masterBtnDanger =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-900 px-3 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-950/50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none disabled:opacity-50";

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
  tone?: "plain" | "teal" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "teal"
          ? "border-teal-900 bg-teal-950/40"
          : tone === "warn"
            ? "border-amber-900 bg-amber-950/30"
            : "border-slate-800 bg-slate-900/60",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "teal"
            ? "text-teal-300"
            : tone === "warn"
              ? "text-amber-300"
              : "text-slate-400",
        )}
      >
        {icon}
        {label}
      </p>
      <p className="mt-2 text-2xl leading-none font-bold text-slate-50 tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

const TENANT_TONE = {
  active: "bg-teal-950 text-teal-300 ring-teal-900",
  trialing: "bg-amber-950 text-amber-300 ring-amber-900",
  frozen: "bg-slate-800 text-slate-400 ring-slate-700",
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
    <div className="rounded-2xl border border-dashed border-slate-800 px-5 py-12 text-center">
      <p className="text-sm font-semibold text-slate-300">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
        {body}
      </p>
    </div>
  );
}
