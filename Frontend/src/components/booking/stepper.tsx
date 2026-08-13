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
        className="relative mb-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-(--accent) transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300",
                  done && "bg-(--accent) text-(--accent-contrast)",
                  // The current step is the only marker that lifts off the
                  // page. Elevation is doing what a third colour would
                  // otherwise have to.
                  active &&
                    "shadow-accent scale-110 bg-(--accent) text-(--accent-contrast)",
                  !done &&
                    !active &&
                    "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : step}
              </span>
              <span
                className={cn(
                  "text-xs transition-colors",
                  active
                    ? "font-semibold text-zinc-900 dark:text-zinc-100"
                    : // zinc-500 is the floor for text on white (4.6:1).
                      // zinc-400 measures 2.6:1 and was failing AA here.
                      "font-medium text-zinc-500",
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
