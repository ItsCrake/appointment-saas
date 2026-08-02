"use client";

import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";

import { formatPrice } from "@/lib/format";
import {
  PRICING_TIERS,
  TRIAL_DAYS,
  yearlySavingsPercent,
  type PlanType,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

type Props = {
  selected: PlanType;
  pending: boolean;
  onBack: () => void;
  onSubmit: (planType: PlanType) => void;
};

export function SetupPlanStep({ selected, pending, onBack, onSubmit }: Props) {
  const [plan, setPlan] = useState<PlanType>(selected);

  return (
    <div>
      <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        בחירת מסלול
      </h2>
      <p className="mt-1 mb-4 text-sm text-neutral-500">
        {TRIAL_DAYS} ימי ניסיון בחינם בכל המסלולים. לא נבקש כרטיס אשראי, ואפשר
        לשנות מסלול בכל שלב.
      </p>

      <ul className="space-y-3" role="radiogroup" aria-label="בחירת מסלול">
        {PRICING_TIERS.map((tier) => {
          const active = plan === tier.id;

          return (
            <li key={tier.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPlan(tier.id)}
                className={cn(
                  "w-full rounded-2xl border bg-white p-4 text-start transition-all active:scale-[0.99]",
                  "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none",
                  "dark:bg-neutral-900",
                  active
                    ? "border-teal-700 ring-1 ring-teal-700"
                    : "border-neutral-200 hover:border-teal-600 dark:border-neutral-800",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {tier.name}
                      </span>
                      {tier.highlighted ? (
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200">
                          מומלץ
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                      {tier.tagline}
                    </span>
                  </span>

                  <span className="shrink-0 text-end">
                    <span className="block font-bold text-neutral-900 tabular-nums dark:text-neutral-100">
                      {formatPrice(tier.monthlyCents)}
                    </span>
                    <span className="block text-[11px] text-neutral-500">
                      לחודש
                    </span>
                  </span>
                </span>

                <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {tier.features.slice(0, 3).map((feature) => (
                    <span
                      key={feature}
                      className="inline-flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-400"
                    >
                      <Check
                        className="size-3 shrink-0 text-teal-700 dark:text-teal-400"
                        aria-hidden
                      />
                      {feature}
                    </span>
                  ))}
                </span>

                <span className="mt-2 block text-[11px] text-teal-800 dark:text-teal-300">
                  בחיוב שנתי חוסכים {yearlySavingsPercent(tier)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-12 rounded-xl border border-neutral-300 px-5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          חזרה
        </button>
        <button
          type="button"
          onClick={() => onSubmit(plan)}
          disabled={pending}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-semibold text-white shadow-sm transition-all hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99] disabled:opacity-60"
        >
          המשך
          <ArrowLeft className="size-4" aria-hidden />
        </button>
      </div>

      {/* Said plainly rather than buried: nothing is charged at this point. */}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-400">
        לא מתבצע חיוב עכשיו. נציג יצור קשר לפני תום תקופת הניסיון.
      </p>
    </div>
  );
}
