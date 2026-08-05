"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { formatPrice } from "@/lib/format";
import {
  headlineSavingsPercent,
  PRICING_TIERS,
  priceForCycle,
  yearlySavingsPercent,
  type BillingCycle,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * The only interactive part of the pricing section. Kept as its own island so
 * the surrounding landing page stays a static server component.
 *
 * Soft geometry matching the page: pill for interactive, rounded shell for the
 * grid. The highlighted tier inverts to solid ink and carries the brand
 * gradient on its badge and its action, so colour marks the recommended choice
 * without the card itself becoming a block of gradient.
 */
export function PricingTable() {
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const savings = headlineSavingsPercent();

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="מחזור חיוב"
        className="inline-flex items-center rounded-full border border-zinc-300 p-1 dark:border-zinc-700"
      >
        {(
          [
            ["monthly", "חודשי"],
            ["yearly", "שנתי"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={cycle === value}
            onClick={() => setCycle(value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
              "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none focus-visible:ring-inset dark:focus-visible:ring-white",
              cycle === value
                ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50",
            )}
          >
            {label}
            {value === "yearly" && savings > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  cycle === "yearly"
                    ? "bg-white/20 text-white dark:bg-zinc-950/15 dark:text-zinc-950"
                    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                )}
              >
                חסכו {savings}%
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        {cycle === "yearly"
          ? "המחיר מוצג לחודש, בחיוב שנתי מראש."
          : "המחיר לחודש, בחיוב חודשי. אפשר לבטל בכל רגע."}
      </p>

      {/* Two tiers, so the grid is capped rather than stretched across the full
          container: two cards on a three-column track read as a missing third. */}
      <ul className="mt-8 grid max-w-3xl gap-px overflow-hidden rounded-3xl bg-zinc-200 sm:grid-cols-2 dark:bg-zinc-800">
        {PRICING_TIERS.map((tier) => {
          const price = priceForCycle(tier, cycle);
          const tierSaving = yearlySavingsPercent(tier);
          const featured = Boolean(tier.highlighted);

          return (
            <li
              key={tier.id}
              className={cn(
                "flex flex-col p-7",
                featured
                  ? "bg-zinc-950 dark:bg-zinc-100"
                  : "bg-white dark:bg-zinc-950",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3
                  className={cn(
                    "text-lg font-bold tracking-tight",
                    featured
                      ? "text-white dark:text-zinc-950"
                      : "text-zinc-950 dark:text-zinc-50",
                  )}
                >
                  {tier.name}
                </h3>
                {featured ? (
                  <span className="rounded-full bg-[image:var(--brand-gradient)] px-2.5 py-1 text-[10px] font-bold text-white">
                    הכי פופולרי
                  </span>
                ) : null}
              </div>

              <p
                className={cn(
                  "mt-1.5 min-h-10 text-sm leading-relaxed",
                  featured
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-600 dark:text-zinc-400",
                )}
              >
                {tier.tagline}
              </p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span
                  className={cn(
                    "text-4xl font-black tracking-tighter tabular-nums",
                    featured
                      ? "text-white dark:text-zinc-950"
                      : "text-zinc-950 dark:text-zinc-50",
                  )}
                >
                  {formatPrice(price)}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    featured
                      ? "text-zinc-400 dark:text-zinc-600"
                      : "text-zinc-500",
                  )}
                >
                  / לחודש
                </span>
              </p>

              <p
                className={cn(
                  "mt-1 text-xs",
                  featured
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-500",
                )}
              >
                {cycle === "yearly"
                  ? `חיוב שנתי ${formatPrice(tier.yearlyCents)}, חיסכון ${tierSaving}%`
                  : "ללא התחייבות, ביטול בכל עת"}
              </p>

              <ul className="mt-7 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className={cn(
                      "flex items-start gap-2.5 text-sm",
                      featured
                        ? "text-zinc-300 dark:text-zinc-700"
                        : "text-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        featured
                          ? "text-white dark:text-zinc-950"
                          : "text-zinc-950 dark:text-zinc-50",
                      )}
                      aria-hidden
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={`/dashboard/setup?plan=${tier.id}`}
                className={cn(
                  "mt-8 inline-flex h-11 w-full items-center justify-center rounded-full text-sm font-semibold whitespace-nowrap transition-opacity",
                  "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px",
                  featured
                    ? // The recommended tier's action is the one gradient fill
                      // on the page outside the closing banner. White on the
                      // darkest stop of the ramp measures well past AA.
                      "bg-[image:var(--brand-gradient)] text-white hover:opacity-90 focus-visible:ring-white focus-visible:ring-offset-zinc-950 dark:focus-visible:ring-offset-zinc-100"
                    : "border border-zinc-300 text-zinc-950 transition-colors hover:border-zinc-950 hover:bg-zinc-50 focus-visible:ring-zinc-950 dark:border-zinc-700 dark:text-zinc-50 dark:hover:border-zinc-100 dark:hover:bg-zinc-900 dark:focus-visible:ring-white",
                )}
              >
                התחלת ניסיון
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
