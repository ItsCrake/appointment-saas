import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = ["שירות", "מועד", "אישור"] as const;

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="px-5 pb-6">
      {/* Continuous rail behind the markers: three disconnected dots do not
          read as progress, a filling bar does. */}
      <div
        aria-hidden
        className="relative mb-2 h-1 rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div
          className="h-full rounded-full bg-(--accent) transition-[width] duration-300 ease-out"
          style={{ width: `${((current - 1) / (STEPS.length - 1)) * 100}%` }}
        />
      </div>

      <ol
        className="flex items-center justify-between"
        aria-label="שלבי קביעת התור"
      >
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;

          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                  done && "bg-(--accent) text-(--accent-contrast)",
                  active &&
                    "bg-(--accent) text-(--accent-contrast) ring-2 ring-(--accent-soft-border)",
                  !done &&
                    !active &&
                    "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : step}
              </span>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  active
                    ? "text-neutral-900 dark:text-neutral-100"
                    : done
                      ? "text-neutral-500"
                      : "text-neutral-400",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
