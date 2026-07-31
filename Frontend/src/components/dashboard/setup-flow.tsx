"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import {
  completeOnboardingAction,
  saveBusinessDetailsAction,
  saveStarterServicesAction,
  saveSetupHoursAction,
} from "@/app/dashboard/setup/actions";
import { cn } from "@/lib/utils";

import { SetupDetailsStep } from "./setup-details-step";
import { SetupDoneStep } from "./setup-done-step";
import { SetupHoursStep } from "./setup-hours-step";
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

type Step = "details" | "services" | "hours" | "done";

const STEP_LABELS: Record<Step, string> = {
  details: "פרטי העסק",
  services: "שירותים",
  hours: "שעות",
  done: "סיום",
};

const ORDER: Step[] = ["details", "services", "hours", "done"];

export function SetupFlow({
  step,
  business,
  services,
  shifts,
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
  appUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function go(next: string) {
    if (next.startsWith("/")) router.push(next);
    else router.push(`/dashboard/setup?step=${next}`);
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
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          {step === "done" ? "הכול מוכן!" : "הקמת העסק שלכם"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {step === "done"
            ? "עמוד ההזמנות שלכם באוויר"
            : "ארבעה שלבים קצרים. אפשר לשנות הכול אחר כך."}
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
                  done &&
                    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                  active &&
                    "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
                  !done && !active && "text-neutral-400",
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
                    done
                      ? "bg-emerald-500"
                      : "bg-neutral-200 dark:bg-neutral-800",
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
        {step === "details" ? (
          <SetupDetailsStep
            business={business}
            pending={pending}
            onSubmit={(values) =>
              submit(() => saveBusinessDetailsAction(values))
            }
          />
        ) : null}

        {step === "services" ? (
          <SetupServicesStep
            existing={services}
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
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          שומר…
        </p>
      ) : null}
    </div>
  );
}
