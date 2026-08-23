"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import {
  completeOnboardingAction,
  saveBusinessDetailsAction,
  savePlanAction,
  saveStarterServicesAction,
  saveSetupHoursAction,
} from "@/app/dashboard/setup/actions";
import { BRAND } from "@/lib/brand";
import type { PlanType } from "@/lib/plans";
import type { OnboardingPreset } from "@/lib/onboarding-presets";
import { cn } from "@/lib/utils";

import { SetupDetailsStep } from "./setup-details-step";
import { SetupPresetStep } from "./setup-preset-step";
import { SetupDoneStep } from "./setup-done-step";
import { SetupHoursStep } from "./setup-hours-step";
import { SetupPlanStep } from "./setup-plan-step";
import { SetupServicesStep, type DraftService } from "./setup-services-step";

export type SetupBusiness = {
  name: string;
  slug: string;
  phone: string;
  timezone: string;
};

export type SetupShift = {
  weekday: number;
  startTime: string;
  endTime: string;
};

type Step = "preset" | "details" | "services" | "hours" | "plan" | "done";

const STEP_LABELS: Record<Step, string> = {
  preset: "סוג העסק",
  details: "פרטי העסק",
  services: "שירותים",
  hours: "שעות",
  plan: "מסלול",
  done: "סיום",
};

const ORDER: Step[] = [
  "preset",
  "details",
  "services",
  "hours",
  "plan",
  "done",
];

export function SetupFlow({
  step,
  business,
  services,
  shifts,
  planType,
  preset,
  appUrl,
}: {
  step: Step;
  business: SetupBusiness | null;
  services: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
  }[];
  shifts: SetupShift[];
  planType: PlanType;
  /**
   * The row's saved choice, or the `?preset=` hint before the row exists. Null
   * for every shop created before 0026 and for anyone deep-linking past step 0.
   */
  preset: OnboardingPreset | null;
  appUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  /**
   * `params` carries the preset from step 0 into step 1, which is the only hop
   * that needs it — once `saveBusinessDetailsAction` has run it lives on the
   * business row and the page reads it from there.
   */
  function go(next: string, params: Record<string, string> = {}) {
    if (next.startsWith("/")) {
      router.push(next);
      return;
    }
    const query = new URLSearchParams({ step: next, ...params });
    router.push(`/dashboard/setup?${query}`);
  }

  /**
   * Every step submits through here so error and pending handling is shared.
   * No router.refresh() after the push: the action already revalidated this
   * path, and refreshing the current URL cancels the pending navigation.
   */
  function submit(
    run: () => Promise<{ ok: boolean; next?: string; error?: string }>,
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await run();
      if (result.ok && result.next) go(result.next);
      else if (!result.ok) setError(result.error);
    });
  }

  const currentIndex = ORDER.indexOf(step);

  return (
    <div>
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {step === "done" ? "הכול מוכן!" : `ברוכים הבאים ל${BRAND.name}`}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {step === "done"
            ? "עמוד ההזמנות שלכם באוויר"
            : "כמה שלבים קצרים. אפשר לשנות הכול אחר כך."}
        </p>
      </header>

      <ol
        className="mb-6 flex items-center justify-center gap-1.5"
        aria-label="שלבי ההקמה"
      >
        {ORDER.map((value, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={value} className="flex items-center gap-1.5">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  // Only the current step carries the gradient — one active
                  // thing at a time, as on `/`. Completed steps go quiet
                  // rather than competing with it for attention.
                  done &&
                    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                  active && "bg-[image:var(--brand-gradient)] text-white",
                  !done && !active && "text-zinc-400",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : null}
                {STEP_LABELS[value]}
              </span>
              {index < ORDER.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-3",
                    done ? "bg-zinc-400" : "bg-zinc-200 dark:bg-zinc-800",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div key={step} className="animate-step">
        {step === "preset" ? (
          <SetupPresetStep
            selected={preset}
            // Writes nothing: there is no business row yet, so the choice
            // travels as a query param and is persisted at the next step.
            onSubmit={(next) => go("details", { preset: next })}
          />
        ) : null}

        {step === "details" ? (
          <SetupDetailsStep
            business={business}
            pending={pending}
            onBack={() => go("preset")}
            onSubmit={(values) =>
              submit(() => saveBusinessDetailsAction({ ...values, preset }))
            }
          />
        ) : null}

        {step === "services" ? (
          <SetupServicesStep
            existing={services}
            preset={preset}
            pending={pending}
            onBack={() => go("details")}
            onSubmit={(drafts: DraftService[]) =>
              submit(() => saveStarterServicesAction({ services: drafts }))
            }
          />
        ) : null}

        {step === "hours" ? (
          <SetupHoursStep
            shifts={shifts}
            timezone={business?.timezone ?? "Asia/Jerusalem"}
            pending={pending}
            onBack={() => go("services")}
            onSubmit={(next) => submit(() => saveSetupHoursAction(next))}
          />
        ) : null}

        {step === "plan" ? (
          <SetupPlanStep
            selected={planType}
            pending={pending}
            onBack={() => go("hours")}
            onSubmit={(next) =>
              submit(() => savePlanAction({ planType: next }))
            }
          />
        ) : null}

        {step === "done" && business ? (
          <SetupDoneStep
            business={business}
            services={services}
            appUrl={appUrl}
            pending={pending}
            onFinish={() => submit(() => completeOnboardingAction())}
          />
        ) : null}
      </div>

      {pending ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          שומר…
        </p>
      ) : null}
    </div>
  );
}
