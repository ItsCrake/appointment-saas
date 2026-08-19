"use client";

import { useCallback, useState } from "react";

import type { ServiceBreakdown } from "@/db/queries/analytics";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Bar, EmptyState } from "./ui";

export type SortKey = "bookings" | "revenue";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "bookings", label: "הכי מבוקשים" },
  { key: "revenue", label: "הכי רווחיים" },
];

/**
 * Which services earn and which fill the diary.
 *
 * ---------------------------------------------------------------------------
 * **The sort is client state, and it used to be a navigation.** Both orders are
 * the same eight rows — this panel already receives every service and sorts them
 * here — so each toggle was a full round trip that re-ran the trend query, the
 * heatmap, the status summary and the staff split, in order to return data the
 * browser was already holding, and then handed back a fresh page positioned at
 * the top of itself. On a phone, where this panel sits well below the fold, the
 * effect was that answering "which is most profitable?" threw the reader back to
 * the headline cards.
 *
 * `history.replaceState` keeps the URL honest so a refresh or a shared link
 * still opens the order that was on screen, without asking the router to
 * re-render the route. Same bargain, and same reasoning, as the calendar's
 * day/week switch.
 * ---------------------------------------------------------------------------
 */
export function ServicesPanel({
  services,
  initialSort,
}: {
  services: ServiceBreakdown[];
  /** Seeded from `?by=` so a shared link opens on the order it was shared in. */
  initialSort: SortKey;
}) {
  const [sort, setSort] = useState<SortKey>(initialSort);

  const choose = useCallback((next: SortKey) => {
    setSort(next);
    const url = new URL(window.location.href);
    url.searchParams.set("by", next);
    window.history.replaceState(null, "", url);
  }, []);

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
      {/* Buttons, not links: the rows are already here, so changing the order
          is a state change rather than a navigation. */}
      <div
        role="group"
        aria-label="מיון"
        className="mb-4 inline-flex rounded-full border border-zinc-200 p-1 dark:border-zinc-800"
      >
        {SORTS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => choose(key)}
            aria-pressed={key === sort}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              key === sort
                ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {label}
          </button>
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
