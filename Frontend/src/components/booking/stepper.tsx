import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = ["שירות", "מועד", "אישור"] as const;

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      className="flex items-center justify-center gap-2 px-5 pb-6"
      aria-label="שלבי קביעת התור"
    >
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;

        return (
          <li key={label} className="flex items-center gap-2">
            <div
              className="flex items-center gap-2"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  done && "bg-emerald-600 text-white",
                  active &&
                    "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
                  !done &&
                    !active &&
                    "bg-neutral-200 text-neutral-500 dark:bg-neutral-800",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : step}
              </span>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  active
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-400",
                )}
              >
                {label}
              </span>
            </div>
            {step < STEPS.length ? (
              <span
                aria-hidden
                className={cn(
                  "h-px w-6 transition-colors",
                  done
                    ? "bg-emerald-600"
                    : "bg-neutral-200 dark:bg-neutral-800",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
