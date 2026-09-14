"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Mic } from "lucide-react";

import { trialEntitlements } from "@/lib/entitlements";
import { formatPrice } from "@/lib/format";
import {
  headlineSavingsPercent,
  PRICING_TIERS,
  priceForCycle,
  TRIAL_DAYS,
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
  /**
   * Monthly first. The tiers are priced by the month — ₪80 and ₪120 is the
   * sentence the pricing was decided in — and a visitor who has to work out
   * that ₪66.67 means ₪80 billed differently has been handed arithmetic before
   * a reason to sign up. Yearly is one tap away, and its badge says why.
   */
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const savings = headlineSavingsPercent();
  /**
   * Read from the rule, not typed: the sentence under each button promises
   * ליבי during the trial only while the trial actually grants her.
   */
  const trialHasLibi = trialEntitlements().canAccessLibi;

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

              {tier.exclusiveFeature ? (
                /* The one thing only this tier sells, set apart from the list
                   so it is not the fourth bullet somebody skims past. The mic
                   is the mark ליבי's own bookings carry on the calendar. */
                <p
                  className={cn(
                    "mt-7 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm font-semibold",
                    featured
                      ? "bg-white/10 text-white dark:bg-zinc-950/10 dark:text-zinc-950"
                      : "bg-zinc-100 text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50",
                  )}
                >
                  <Mic className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{tier.exclusiveFeature}</span>
                  <span className="shrink-0 rounded-full bg-[image:var(--brand-gradient)] px-2 py-0.5 text-[10px] font-bold text-white">
                    רק ב{tier.name}
                  </span>
                </p>
              ) : null}

              <ul
                className={cn(
                  "flex-1 space-y-3",
                  tier.exclusiveFeature ? "mt-5" : "mt-7",
                )}
              >
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

              {/* The overage is a price like the monthly one, so it is stated
                  beside the list rather than left to the terms. */}
              <p
                className={cn(
                  "mt-5 text-xs leading-relaxed",
                  featured
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-500",
                )}
              >
                מעבר ל-{tier.whatsappIncluded} הודעות בחודש:{" "}
                {formatPrice(tier.whatsappOverage.cents)} לכל{" "}
                {tier.whatsappOverage.per} הודעות נוספות. התורים תמיד ללא
                הגבלה.
              </p>

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
              <p
                className={cn(
                  "mt-2.5 text-center text-xs",
                  featured
                    ? "text-zinc-400 dark:text-zinc-600"
                    : "text-zinc-500",
                )}
              >
                {TRIAL_DAYS} ימים עם כל התכונות
                {trialHasLibi ? ", כולל ליבי" : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
