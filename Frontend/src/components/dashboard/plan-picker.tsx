"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { startCheckoutAction } from "@/app/dashboard/billing/actions";
import { useToast } from "@/components/ui/toast";
import { formatPrice } from "@/lib/format";
import {
  BILLING_CYCLES,
  PRICING_TIERS,
  yearlySavingsPercent,
  type BillingCycle,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: "חודשי",
  yearly: "שנתי",
};

/**
 * Tier selection and checkout.
 *
 * Prices are rendered from the same `PRICING_TIERS` the action charges from,
 * but the action recomputes rather than trusting anything sent from here: a
 * price that travels in a request body is a price the browser can edit.
 */
export function PlanPicker({
  currentPlan,
  currentCycle,
  live,
}: {
  currentPlan: string;
  currentCycle: BillingCycle;
  /** False while no payment provider is configured. */
  live: boolean;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(currentCycle);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  function choose(plan: string) {
    setPendingPlan(plan);
    startTransition(async () => {
      const result = await startCheckoutAction({ plan, cycle });
      setPendingPlan(null);
      if (result.ok) toast(result.message ?? "המסלול עודכן", "success");
      else toast(result.error, "error");
    });
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="מחזור חיוב"
        className="inline-flex items-center rounded-full border border-neutral-300 p-1 dark:border-neutral-700"
      >
        {BILLING_CYCLES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={cycle === value}
            onClick={() => setCycle(value)}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-4 text-xs font-semibold transition-colors",
              "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none",
              cycle === value
                ? "bg-teal-700 text-white"
                : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
            )}
          >
            {CYCLE_LABEL[value]}
          </button>
        ))}
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {PRICING_TIERS.map((tier) => {
          const price =
            cycle === "yearly" ? tier.yearlyCents : tier.monthlyCents;
          const isCurrent = tier.id === currentPlan;
          const busy = isPending && pendingPlan === tier.id;

          return (
            <li
              key={tier.id}
              className={cn(
                "flex flex-col rounded-2xl border p-5",
                isCurrent
                  ? "border-teal-700 ring-1 ring-teal-700"
                  : "border-neutral-200 dark:border-neutral-800",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold text-neutral-900 dark:text-neutral-50">
                  {tier.name}
                </h3>
                {isCurrent ? (
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-200">
                    המסלול שלכם
                  </span>
                ) : null}
              </div>

              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-neutral-900 tabular-nums dark:text-neutral-50">
                  {formatPrice(price)}
                </span>
                <span className="text-xs text-neutral-500">
                  {cycle === "yearly" ? "לשנה" : "לחודש"}
                </span>
              </p>
              {cycle === "yearly" ? (
                <p className="mt-0.5 text-[11px] text-teal-800 dark:text-teal-300">
                  חיסכון {yearlySavingsPercent(tier)}%
                </p>
              ) : null}

              <ul className="mt-4 flex-1 space-y-1.5">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400"
                  >
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-teal-700 dark:text-teal-400"
                      aria-hidden
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => choose(tier.id)}
                disabled={isPending || !live}
                className={cn(
                  "mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 focus-visible:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  isCurrent
                    ? "border border-neutral-300 text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    : "bg-teal-700 text-white hover:bg-teal-800",
                )}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {isCurrent ? "שינוי מחזור החיוב" : `מעבר ל${tier.name}`}
              </button>
            </li>
          );
        })}
      </ul>

      {!live ? (
        // Said once, here, rather than letting every disabled button be its own
        // little mystery.
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          תשלום מקוון עדיין אינו מחובר, ולכן הכפתורים מושבתים. לשינוי מסלול צרו
          קשר ונטפל בזה ידנית.
        </p>
      ) : null}
    </div>
  );
}
