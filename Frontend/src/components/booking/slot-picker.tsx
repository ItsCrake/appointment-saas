"use client";

import { CalendarOff, Moon, Sun, Sunrise } from "lucide-react";

import type { Slot } from "@/lib/availability";
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
  slots: Slot[];
  loading: boolean;
  error?: string;
  selectedSlot?: Slot;
  onSelectSlot: (slot: Slot) => void;
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
        <div className="space-y-5">
          {groupSlotsByPeriod(slots).map(({ period, slots: periodSlots }) => {
            const { label, Icon, tint } = PERIODS[period];

            return (
              <section key={period} aria-labelledby={`period-${period}`}>
                <h3
                  id={`period-${period}`}
                  className="mb-2.5 flex items-center gap-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase"
                >
                  <Icon className={cn("size-4", tint)} aria-hidden />
                  {label}
                  <span className="font-normal text-neutral-400 tabular-nums">
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
                          "focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-neutral-100",
                          active
                            ? "border-neutral-900 bg-neutral-900 text-white shadow-sm dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                            : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-900 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-neutral-100",
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
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-4 py-12 text-center dark:border-neutral-700">
      <div
        aria-hidden
        className="mb-1 flex size-11 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
      >
        <CalendarOff className="size-5 text-neutral-400" />
      </div>
      <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        אין מועדים פנויים ביום זה
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-neutral-500">
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
