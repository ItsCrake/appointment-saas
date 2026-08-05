"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";

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
 */
export function PricingTable() {
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const savings = headlineSavingsPercent();

  return (
    <div>
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label="מחזור חיוב"
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900"
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
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors",
                "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none",
                cycle === value
                  ? "bg-teal-700 text-white"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
              )}
            >
              {label}
              {value === "yearly" && savings > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    cycle === "yearly"
                      ? "bg-white/20 text-white"
                      : "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
                  )}
                >
                  חסכו {savings}%
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-neutral-500">
        {cycle === "yearly"
          ? "המחיר מוצג לחודש, בחיוב שנתי מראש."
          : "המחיר לחודש, בחיוב חודשי. אפשר לבטל בכל רגע."}
      </p>

      {/* Two tiers, so the grid is capped and centred rather than stretched
          across the full container — two cards on a three-column track read as
          a missing third. */}
      <ul className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-2">
        {PRICING_TIERS.map((tier) => {
          const price = priceForCycle(tier, cycle);
          const tierSaving = yearlySavingsPercent(tier);

          return (
            <li
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-white p-6 dark:bg-neutral-900",
                tier.highlighted
                  ? "border-teal-700 shadow-lg ring-1 ring-teal-700"
                  : "border-neutral-200 dark:border-neutral-800",
              )}
            >
              {tier.highlighted ? (
                <span className="absolute -top-3 inline-flex items-center gap-1 rounded-full bg-teal-700 px-3 py-1 text-[11px] font-bold text-white">
                  <Sparkles className="size-3" aria-hidden />
                  הכי פופולרי
                </span>
              ) : null}

              <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {tier.name}
              </h3>
              <p className="mt-1 min-h-10 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {tier.tagline}
              </p>

              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-neutral-900 tabular-nums dark:text-neutral-50">
                  {formatPrice(price)}
                </span>
                <span className="text-sm text-neutral-500">/ לחודש</span>
              </p>

              {cycle === "yearly" ? (
                <p className="mt-1 text-xs font-medium text-teal-800 dark:text-teal-300">
                  חיוב שנתי {formatPrice(tier.yearlyCents)} — חיסכון{" "}
                  {tierSaving}%
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-400">
                  ללא התחייבות, ביטול בכל עת
                </p>
              )}

              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-400"
                      aria-hidden
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={`/dashboard/setup?plan=${tier.id}`}
                className={cn(
                  "mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none",
                  tier.highlighted
                    ? "bg-teal-700 text-white hover:bg-teal-800"
                    : "border border-neutral-300 text-neutral-800 hover:border-teal-700 hover:text-teal-800 dark:border-neutral-700 dark:text-neutral-200 dark:hover:text-teal-300",
                )}
              >
                התחלת תקופת ניסיון
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
