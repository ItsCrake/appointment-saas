"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

import type { SlotWithStaff } from "@/lib/availability";
import { dayOfMonth, monthLabel, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { SlotPicker } from "./slot-picker";

type Props = {
  dates: string[];
  /** The first entry of `dates`; used to label "today" and "tomorrow". */
  today: string;
  selectedDate: string;
  slots: SlotWithStaff[];
  loading: boolean;
  /** A slot *fetch* failure — the picker has nothing to show. */
  error?: string;
  /** A previous *booking* failure. Slots below are still valid and selectable. */
  notice?: string;
  selectedSlot?: SlotWithStaff;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: SlotWithStaff) => void;
};

export function DateTimeStep({
  dates,
  today,
  selectedDate,
  slots,
  loading,
  error,
  notice,
  selectedSlot,
  onSelectDate,
  onSelectSlot,
  onJoinWaitlist,
}: Props & { onJoinWaitlist?: () => void }) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Keep the active day visible when the strip re-renders on a date change.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedDate]);

  return (
    <section aria-labelledby="datetime-heading" className="px-5">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2
          id="datetime-heading"
          className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-100"
        >
          בחרו מועד
        </h2>
        <p className="text-xs font-medium text-zinc-500">
          {monthLabel(selectedDate)}
        </p>
      </div>

      {/* Horizontal day strip — thumb-friendly and avoids a full calendar on
          mobile. Negative margin lets it bleed to the screen edge so the last
          card is visibly cut off, which reads as "scrollable". */}
      <div
        // `pt-2` is not decoration: the active chip translates upward and casts
        // a shadow, and an overflow container clips both without it.
        className="-mx-5 mb-6 flex snap-x [scrollbar-width:none] gap-2 overflow-x-auto px-5 pt-2 pb-3 [&::-webkit-scrollbar]:hidden"
        role="radiogroup"
        aria-label="בחירת יום"
      >
        {dates.map((date, index) => {
          const active = date === selectedDate;
          const relative =
            date === today ? "היום" : index === 1 ? "מחר" : weekdayLabel(date);

          return (
            <button
              key={date}
              ref={active ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={active}
              className={cn(
                "flex w-16 shrink-0 snap-center flex-col items-center gap-1.5 rounded-2xl py-3.5",
                "ring-1 ring-inset",
                // Transform is deliberately absent from the transition list.
                // The selected chip's lift is a *state*, so it snaps; animating
                // it would move the chip under the pointer for 200ms after every
                // date change — on top of the smooth scroll this strip already
                // performs — and a click landing in that window hits a target
                // that is still travelling.
                "transition-[background-color,box-shadow,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95",
                "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                active
                  ? // The selected day is the only chip that leaves the strip,
                    // which is what lets the eye find it after a scroll.
                    "shadow-accent -translate-y-0.5 bg-(--accent) text-(--accent-contrast) ring-(--accent)"
                  : "shadow-lift bg-white text-zinc-700 ring-zinc-900/8 hover:ring-(--accent) dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10",
              )}
              onClick={() => onSelectDate(date)}
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active ? "opacity-85" : "text-zinc-500",
                )}
              >
                {relative}
              </span>
              <span className="text-xl leading-none font-bold tracking-[-0.02em] tabular-nums">
                {dayOfMonth(date)}
              </span>
            </button>
          );
        })}
      </div>

      {notice ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-500/15 ring-inset dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      <SlotPicker
        slots={slots}
        loading={loading}
        error={error}
        selectedSlot={selectedSlot}
        onSelectSlot={onSelectSlot}
        onJoinWaitlist={onJoinWaitlist}
      />
    </section>
  );
}
