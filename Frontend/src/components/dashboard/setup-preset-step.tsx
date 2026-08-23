"use client";

import { useState } from "react";
import { Check, Scissors, Sparkles, PencilRuler } from "lucide-react";

import { formatDuration, formatPrice } from "@/lib/format";
import { PRESET_LIST, type OnboardingPreset } from "@/lib/onboarding-presets";
import { cn } from "@/lib/utils";

const ICONS: Record<OnboardingPreset, typeof Scissors> = {
  barbershop: Scissors,
  nails: Sparkles,
  custom: PencilRuler,
};

/**
 * Step 0 — "what kind of shop is this?"
 *
 * ---------------------------------------------------------------------------
 * **The only step that writes nothing.** It runs before the business row
 * exists, so the choice travels to step 1 as `?preset=` and is persisted when
 * `saveBusinessDetailsAction` creates the row — the same one-shot hint `?plan=`
 * already uses. That ordering is deliberate: asking the trade first is what
 * lets every later screen open with plausible content, and a step that had to
 * create a row first would have to ask for a name before it could ask anything
 * useful.
 *
 * **Each card shows exactly what it will fill in.** A preset that silently
 * changed three screens would be a thing done *to* the owner; listing the
 * services on the card makes it an offer, and makes the "you can change all of
 * this" line underneath believable rather than reassuring noise.
 * ---------------------------------------------------------------------------
 */
export function SetupPresetStep({
  selected,
  onSubmit,
}: {
  selected: OnboardingPreset | null;
  onSubmit: (preset: OnboardingPreset) => void;
}) {
  const [choice, setChoice] = useState<OnboardingPreset | null>(selected);

  return (
    <div>
      <p className="mb-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        נתחיל מנקודת פתיחה שמתאימה לכם. זה רק כדי לחסוך הקלדה — אפשר לערוך,
        למחוק ולהוסיף הכול בשלבים הבאים.
      </p>

      <ul className="space-y-3">
        {PRESET_LIST.map((preset) => {
          const Icon = ICONS[preset.id];
          const active = choice === preset.id;

          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => setChoice(preset.id)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-4 text-right transition-colors",
                  active
                    ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                    : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
                    active
                      ? "bg-[image:var(--brand-gradient)] text-white"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                  )}
                >
                  <Icon className="size-4.5" aria-hidden />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {preset.label}
                    </span>
                    {active ? (
                      <Check
                        className="size-3.5 text-zinc-900 dark:text-zinc-50"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    {preset.description}
                  </span>

                  {/* Named, not counted. "3 שירותים" would be a promise the
                      owner cannot check before committing to it. */}
                  {preset.services.some((service) => service.name) ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {preset.services
                        .filter((service) => service.name)
                        .map((service) => (
                          <span
                            key={service.name}
                            className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-400"
                          >
                            {service.name} ·{" "}
                            {formatDuration(service.durationMin)} ·{" "}
                            {formatPrice(service.priceCents)}
                          </span>
                        ))}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => choice && onSubmit(choice)}
        disabled={!choice}
        className="mt-5 h-12 w-full rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        המשך
      </button>
    </div>
  );
}
