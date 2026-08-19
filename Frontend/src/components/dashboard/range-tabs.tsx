"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  ANALYTICS_RANGES,
  RANGE_LABELS,
  type AnalyticsRange,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * The time range. A real navigation, because a different range is different
 * data — every query on the page is scoped by it.
 *
 * ---------------------------------------------------------------------------
 * **It reads `by` from the live URL rather than from a prop, and that is the
 * whole reason this is a client component.** The services sort is now held in
 * the browser and written to the address bar with `replaceState`, which
 * deliberately does not re-render the route — so a `sort` passed down at render
 * time goes stale the moment somebody switches to "הכי רווחיים". These links
 * would then still carry `by=bookings`, and changing the range would quietly
 * throw away the order the reader had chosen.
 *
 * Reading the parameter at click time makes the two controls compose: whichever
 * you touch last, the other keeps its state.
 * ---------------------------------------------------------------------------
 */
export function RangeTabs({ current }: { current: AnalyticsRange }) {
  const params = useSearchParams();
  const sort = params.get("by") === "revenue" ? "revenue" : "bookings";

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
