"use client";

import type { CSSProperties } from "react";
import { BellRing, CalendarOff, Moon, Sun, Sunrise } from "lucide-react";

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
  onJoinWaitlist,
}: Props & { onJoinWaitlist?: () => void }) {
  // aria-busy rather than swapping the live region's identity, so a screen
  // reader announces the result instead of a container appearing.
  return (
    <div aria-live="polite" aria-busy={loading}>
      {loading ? (
        <SlotSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : slots.length === 0 ? (
        <EmptyState onJoinWaitlist={onJoinWaitlist} />
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
                {/* `uppercase` is dropped, not restyled. Hebrew has no case,
                    so it did nothing to the label it was applied to — and
                    `tracking-wide` on an unmodified Hebrew string only loosens
                    letters that were never meant to be spaced. */}
                <h3
                  id={`period-${period}`}
                  className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-500"
                >
                  <Icon className={cn("size-4", tint)} aria-hidden />
                  {label}
                  <span className="font-normal text-zinc-500 tabular-nums">
                    ({periodSlots.length})
                  </span>
                </h3>

                <div
                  role="radiogroup"
                  aria-labelledby={`period-${period}`}
                  className="grid grid-cols-3 gap-2.5 sm:grid-cols-4"
                >
                  {periodSlots.map((slot, index) => {
                    const active = selectedSlot?.startsAt === slot.startsAt;

                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onSelectSlot(slot)}
                        // Clamped hard: a busy morning can hold twenty of
                        // these, and an unclamped stagger would still be
                        // animating long after the thumb arrived.
                        style={{ "--i": Math.min(index, 5) } as CSSProperties}
                        className={cn(
                          "animate-rise h-13 text-sm font-semibold tabular-nums",
                          // Transform excluded: the press scale snaps down and
                          // back rather than easing, which both feels crisper
                          // and keeps the button stable the instant it is
                          // released.
                          "transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95",
                          "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                          // Radius from the owner's corner setting either way,
                          // so a chosen slot keeps the shape of the ones
                          // around it.
                          "rounded-(--radius-card)",
                          // A free slot wears the shop's own card material
                          // rather than a hardcoded white, so a glass page gets
                          // glass slots instead of twenty opaque tiles sitting
                          // on top of it.
                          //
                          // The chosen one deliberately does *not* use
                          // `.booking-card`: that class paints `--card-bg` as a
                          // `background-image`, which composites over
                          // `background-color` and would swallow the accent
                          // fill entirely. Solid accent is the whole point of
                          // the selected state, so it is drawn on its own.
                          active
                            ? "shadow-accent bg-(--accent) text-(--accent-contrast) ring-1 ring-(--accent) ring-inset"
                            : "booking-card text-zinc-800 dark:text-zinc-200",
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
          <div className="mb-3 flex items-center gap-2">
            <div className="animate-shimmer size-4 rounded" />
            <div className="animate-shimmer h-3 w-16 rounded" />
          </div>
          {/* Same height, radius and gap as the real grid, so the swap when
              slots arrive shifts nothing. */}
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="animate-shimmer h-13 rounded-2xl" />
            ))}
          </div>
        </div>
      ))}
      <p className="sr-only">טוען מועדים פנויים…</p>
    </div>
  );
}

function EmptyState({ onJoinWaitlist }: { onJoinWaitlist?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-zinc-300 bg-zinc-50/50 px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
      <div
        aria-hidden
        className="mb-1 flex size-12 items-center justify-center rounded-full bg-zinc-100 ring-1 ring-zinc-900/5 ring-inset dark:bg-zinc-800 dark:ring-white/10"
      >
        <CalendarOff className="size-5 text-zinc-500" />
      </div>
      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        אין מועדים פנויים ביום זה
      </p>
      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
        נסו לבחור יום אחר בסרגל התאריכים למעלה — בדרך כלל יש מקום תוך
        יום-יומיים.
      </p>

      {/* Offered exactly where the disappointment is, rather than parked in a
          header somebody scrolled past ten seconds ago. This is the moment the
          answer "there is nothing" is on screen, and it is the only moment a
          waitlist is obviously worth joining. */}
      {onJoinWaitlist ? (
        <button
          type="button"
          onClick={onJoinWaitlist}
          className="mt-2 inline-flex h-10 items-center gap-2 rounded-full bg-(--accent) px-4 text-xs font-bold text-(--accent-contrast) transition-opacity hover:opacity-90"
        >
          <BellRing className="size-4" aria-hidden />
          אין תור פנוי? הצטרפו לרשימת ההמתנה
        </button>
      ) : null}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-2xl bg-red-50 px-4 py-6 text-center text-sm text-red-700 ring-1 ring-red-600/15 ring-inset dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </p>
  );
}
