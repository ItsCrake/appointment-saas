"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

import type { Slot } from "@/lib/availability";
import { dayOfMonth, monthLabel, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import { SlotPicker } from "./slot-picker";

type Props = {
  dates: string[];
  /** The first entry of `dates`; used to label "today" and "tomorrow". */
  today: string;
  selectedDate: string;
  slots: Slot[];
  loading: boolean;
  /** A slot *fetch* failure — the picker has nothing to show. */
  error?: string;
  /** A previous *booking* failure. Slots below are still valid and selectable. */
  notice?: string;
  selectedSlot?: Slot;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: Slot) => void;
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
}: Props) {
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
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2
          id="datetime-heading"
          className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
        >
          בחרו מועד
        </h2>
        <p className="text-xs text-neutral-500">{monthLabel(selectedDate)}</p>
      </div>

      {/* Horizontal day strip — thumb-friendly and avoids a full calendar on
          mobile. Negative margin lets it bleed to the screen edge so the last
          card is visibly cut off, which reads as "scrollable". */}
      <div
        className="-mx-5 mb-6 flex snap-x [scrollbar-width:none] gap-2 overflow-x-auto px-5 pb-2 [&::-webkit-scrollbar]:hidden"
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
                "flex w-16 shrink-0 snap-center flex-col items-center gap-1 rounded-2xl border py-3",
                "transition-all duration-150 active:scale-95",
                "focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none",
                active
                  ? "border-(--accent) bg-(--accent) text-(--accent-contrast) shadow-md"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-(--accent) hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
              )}
              onClick={() => onSelectDate(date)}
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active ? "opacity-80" : "text-neutral-500",
                )}
              >
                {relative}
              </span>
              <span className="text-xl leading-none font-bold tabular-nums">
                {dayOfMonth(date)}
              </span>
            </button>
          );
        })}
      </div>

      {notice ? (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
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
      />
    </section>
  );
}
