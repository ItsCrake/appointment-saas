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

import { btnPrimary, btnSecondary } from "./ui";

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
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        בחירת מסלול
      </h2>
      <p className="mt-1 mb-4 text-sm text-zinc-500">
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
                  "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-white",
                  "dark:bg-zinc-900",
                  active
                    ? "border-zinc-950 ring-1 ring-zinc-950 dark:border-zinc-50 dark:ring-zinc-50"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {tier.name}
                      </span>
                      {tier.highlighted ? (
                        <span className="rounded-full bg-[image:var(--brand-gradient)] px-2.5 py-1 text-[10px] font-bold text-white">
                          מומלץ
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
                      {tier.tagline}
                    </span>
                  </span>

                  <span className="shrink-0 text-end">
                    <span className="block font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                      {formatPrice(tier.monthlyCents)}
                    </span>
                    <span className="block text-[11px] text-zinc-500">
                      לחודש
                    </span>
                  </span>
                </span>

                <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {tier.features.slice(0, 3).map((feature) => (
                    <span
                      key={feature}
                      className="inline-flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-400"
                    >
                      <Check
                        className="size-3 shrink-0 text-zinc-950 dark:text-zinc-50"
                        aria-hidden
                      />
                      {feature}
                    </span>
                  ))}
                </span>

                <span className="mt-2 block text-[11px] font-medium text-zinc-500">
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
          className={cn(btnSecondary, "h-12")}
        >
          חזרה
        </button>
        <button
          type="button"
          onClick={() => onSubmit(plan)}
          disabled={pending}
          className={cn(btnPrimary, "h-12 flex-1")}
        >
          המשך
          <ArrowLeft className="size-4" aria-hidden />
        </button>
      </div>

      {/* Said plainly rather than buried: nothing is charged at this point. */}
      <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-400">
        לא מתבצע חיוב עכשיו. נציג יצור קשר לפני תום תקופת הניסיון.
      </p>
    </div>
  );
}
