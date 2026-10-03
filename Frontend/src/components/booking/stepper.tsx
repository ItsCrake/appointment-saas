import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { useCopy } from "./copy-context";

/**
 * The three moments of a booking, named as the client experiences them.
 *
 * "בחרו טיפול" rather than "שירות": the label is an instruction at the step the
 * client is actually on, and a bare noun makes the row read as a table of
 * contents for a page they cannot navigate. The other two stay nouns because
 * they are destinations rather than things to do yet.
 *
 * Built per render rather than frozen at module load. A `const` array is
 * evaluated when the module is imported, which is long before anything on the
 * page knows what language it is being read in.
 */
const steps = (t: ReturnType<typeof useCopy>) =>
  [
    t("step.service", "בחרו טיפול"),
    t("step.datetime", "מועד"),
    t("step.confirm", "סיכום ואישור"),
  ] as const;

/**
 * Where the client is, as a quiet line of progress.
 *
 * ---------------------------------------------------------------------------
 * **It reads as a map, not as controls.** It used to be three filled pills with
 * icons, and on a page whose cards are the things to press, three more rounded
 * shapes in the tenant's colour read as three more buttons — owners watched
 * clients tap "מועד" expecting to jump ahead. Now each step is a small numbered
 * dot and a plain label, joined by hairlines: nothing here has a surface, so
 * nothing here invites a tap.
 *
 * **One filled dot, never three.** The current step's dot carries `--accent`
 * and its measured `--accent-contrast`; a finished step drops to the tinted
 * `--accent-soft` and trades its number for a tick; an upcoming one is an
 * outline. The current label is the only one in ink and semibold.
 *
 * **The tick, not the tint, says "done"**, so the row survives greyscale, a
 * colour-blind reader and the accessibility widget's contrast mode.
 *
 * **Not a nav.** `<ol>` plus `aria-current` tells a screen reader where it is
 * without promising a destination.
 * ---------------------------------------------------------------------------
 */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const t = useCopy();
  const STEPS = steps(t);

  return (
    <div className="px-5 pt-3 pb-7">
      <p className="sr-only">
        {t("step.progress", "שלב")} {current} {t("common.of", "מתוך")}{" "}
        {STEPS.length}
      </p>

      <ol
        className="flex items-center justify-center gap-2 sm:gap-3"
        aria-label={t("step.aria", "שלבי קביעת התור")}
      >
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;

          return (
            <li key={label} className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span
                aria-current={active ? "step" : undefined}
                className="flex items-center gap-1.5"
              >
                <span
                  aria-hidden
                  className={cn(
                    "step-pill flex size-5 shrink-0 items-center justify-center text-[10px] font-bold tabular-nums",
                    active &&
                      "shadow-accent bg-(--accent) text-(--accent-contrast)",
                    done && "bg-(--accent-soft) text-(--accent-on-soft)",
                    !done &&
                      !active &&
                      "text-zinc-500 ring-1 ring-zinc-300 ring-inset dark:text-zinc-400 dark:ring-zinc-600",
                  )}
                >
                  {done ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : (
                    step
                  )}
                </span>
                {/* Other labels fold away below 640px rather than wrapping the
                    row; the numbered dots still carry the position, and the
                    current label keeps its words at every width. */}
                <span
                  className={cn(
                    "text-[12px] whitespace-nowrap",
                    active
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : "font-medium text-zinc-500 dark:text-zinc-400",
                    !active && "hidden sm:inline",
                  )}
                >
                  {label}
                </span>
                {active ? (
                  <span className="sr-only">
                    {t("step.current", "— השלב הנוכחי")}
                  </span>
                ) : null}
              </span>

              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-5 shrink-0 transition-colors duration-300 sm:w-8",
                    step < current
                      ? "bg-(--accent)"
                      : "bg-zinc-200 dark:bg-zinc-700",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
