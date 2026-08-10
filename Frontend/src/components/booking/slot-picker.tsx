"use client";

import { CalendarOff, Moon, Sun, Sunrise } from "lucide-react";

import type { SlotWithStaff } from "@/lib/availability";
import { groupSlotsByPeriod, type SlotPeriod } from "@/lib/slot-periods";
import { cn } from "@/lib/utils";

const PERIODS: Record<
  SlotPeriod,
  { label: string; Icon: typeof Sun; tint: string }
> = {
  morning: { label: "בוקר", Icon: Sunrise, tint: "text-amber-500" },
  afternoon: { label: "צהריים", Icon: Sun, tint: "text-orange-500" },
  evening: { label: "ערב", Icon: Moon, tint: "text-indigo-400" },
};

type Props = {
  slots: SlotWithStaff[];
  loading: boolean;
  error?: string;
  selectedSlot?: SlotWithStaff;
  onSelectSlot: (slot: SlotWithStaff) => void;
};

export function SlotPicker({
  slots,
  loading,
  error,
  selectedSlot,
  onSelectSlot,
}: Props) {
  // aria-busy rather than swapping the live region's identity, so a screen
  // reader announces the result instead of a container appearing.
  return (
    <div aria-live="polite" aria-busy={loading}>
      {loading ? (
        <SlotSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : slots.length === 0 ? (
        <EmptyState />
      ) : (
        // Named, and rendered *only* when there are slots. The day strip above
        // has had an accessible name since it was written; the time area had
        // none, so a screen reader landed in a bare list of numbers. It is also
        // the one stable hook for "the fetch finished with something to show" —
        // the per-period radiogroups are labelled by their own heading, whose
        // text carries a count, so none of them has a fixed name.
        <div role="group" aria-label="בחירת שעה" className="space-y-5">
          {groupSlotsByPeriod(slots).map(({ period, slots: periodSlots }) => {
            const { label, Icon, tint } = PERIODS[period];

            return (
              <section key={period} aria-labelledby={`period-${period}`}>
                <h3
                  id={`period-${period}`}
                  className="mb-2.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
                >
                  <Icon className={cn("size-4", tint)} aria-hidden />
                  {label}
                  <span className="font-normal text-zinc-400 tabular-nums">
                    ({periodSlots.length})
                  </span>
                </h3>

                <div
                  role="radiogroup"
                  aria-labelledby={`period-${period}`}
                  className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                >
                  {periodSlots.map((slot) => {
                    const active = selectedSlot?.startsAt === slot.startsAt;

                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onSelectSlot(slot)}
                        className={cn(
                          "h-12 rounded-xl border text-sm font-semibold tabular-nums",
                          "transition-all duration-150 active:scale-95",
                          "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                          active
                            ? "border-(--accent) bg-(--accent) text-(--accent-contrast) shadow-sm"
                            : "border-zinc-200 bg-white text-zinc-800 hover:border-(--accent) hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
                        )}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Mirrors the grouped layout rather than showing a generic block, so the
 * content does not jump when the real slots arrive.
 */
function SlotSkeleton() {
  return (
    <div className="space-y-5">
      {[5, 8].map((count, group) => (
        <div key={group}>
          <div className="mb-2.5 flex items-center gap-2">
            <div className="animate-shimmer size-4 rounded" />
            <div className="animate-shimmer h-3 w-16 rounded" />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="animate-shimmer h-12 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
      <p className="sr-only">טוען מועדים פנויים…</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 px-4 py-12 text-center dark:border-zinc-700">
      <div
        aria-hidden
        className="mb-1 flex size-11 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <CalendarOff className="size-5 text-zinc-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        אין מועדים פנויים ביום זה
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
        נסו לבחור יום אחר בסרגל התאריכים למעלה — בדרך כלל יש מקום תוך
        יום-יומיים.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-2xl bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </p>
  );
}
