import { Calendar, CheckCircle2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The three moments of a booking, named as the client experiences them.
 *
 * "בחרו טיפול" rather than "שירות": the label is an instruction at the step the
 * client is actually on, and a bare noun makes the row read as a table of
 * contents for a page they cannot navigate. The other two stay nouns because
 * they are destinations rather than things to do yet.
 */
const STEPS = [
  { label: "בחרו טיפול", Icon: Sparkles },
  { label: "מועד", Icon: Calendar },
  { label: "סיכום ואישור", Icon: CheckCircle2 },
] as const;

/**
 * Where the client is, as three pills.
 *
 * ---------------------------------------------------------------------------
 * **It sits on the page, not on the hero.** The obvious version of this floats
 * the pills over the tenant's hero photograph, and that is what the reference
 * shots do — but the step lives in `BookingFlow`'s client state while the
 * header is a server component with the gallery between them, so putting it
 * there means lifting state through two components to buy one visual. The pills
 * are built from the same accent tokens the cards use instead, which makes them
 * part of the page rather than a sticker on it.
 *
 * **One filled pill, never three.** The active step carries `--accent` and its
 * measured `--accent-contrast` pair; completed steps drop to the tinted
 * `--accent-soft` surface and gain a tick; upcoming ones are plain zinc. Fill,
 * tint and elevation are doing what a second and third colour would otherwise
 * have to — and on a page whose one colour belongs to the tenant, inventing
 * more is not available.
 *
 * **The tick, not the tint, is what says "done".** State never rides on hue
 * alone here: the icon changes, so the row survives greyscale, a colour-blind
 * reader, and the accessibility widget's contrast mode.
 *
 * **Not a nav.** Nothing is clickable. A pill that looked pressable and refused
 * would be a control that appears to work and does not, which is the one thing
 * this product's principles name outright. `<ol>` plus `aria-current` says the
 * same thing to a screen reader without promising a destination.
 * ---------------------------------------------------------------------------
 */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="px-5 pb-6">
      <p className="mb-2.5 text-center text-[11px] font-medium tracking-wide text-zinc-500">
        שלב {current} מתוך {STEPS.length}
      </p>

      <ol
        className="flex items-center justify-center gap-1"
        aria-label="שלבי קביעת התור"
      >
        {STEPS.map(({ label, Icon }, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;

          return (
            <li key={label} className="flex min-w-0 items-center gap-1">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "step-pill flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap",
                  active &&
                    "shadow-accent bg-(--accent) text-(--accent-contrast)",
                  done && "bg-(--accent-soft) text-(--accent-on-soft)",
                  // zinc-500 is the floor for text on white (4.6:1); zinc-400
                  // measures 2.6:1 and fails AA at this size.
                  !done &&
                    !active &&
                    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden />
                {/* Inactive labels fold away below 640px rather than wrapping
                    the row onto two lines. The icons and the "שלב 1 מתוך 3"
                    line above still carry the position, and the active pill
                    keeps its words at every width — it is the one that has to
                    say what the client is doing right now. */}
                <span className={cn(!active && "hidden sm:inline")}>
                  {label}
                </span>
                {active ? <span className="sr-only">— השלב הנוכחי</span> : null}
              </span>

              {/* A connector, not a rail. Three pills already read as a
                  sequence; a full progress bar under the hero would compete
                  with the one thing the client should be looking at. */}
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-px w-2.5 shrink-0 rounded-full transition-colors duration-300 sm:w-4",
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
