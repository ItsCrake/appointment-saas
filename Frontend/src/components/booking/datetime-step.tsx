"use client";

import { useEffect, useRef } from "react";
import { CalendarOff, Loader2 } from "lucide-react";

import type { Slot } from "@/lib/availability";
import { dayOfMonth, monthLabel, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  dates: string[];
  selectedDate: string;
  slots: Slot[];
  loading: boolean;
  error?: string;
  selectedSlot?: Slot;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: Slot) => void;
};

export function DateTimeStep({
  dates,
  selectedDate,
  slots,
  loading,
  error,
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
      <h2
        id="datetime-heading"
        className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100"
      >
        בחרו מועד
      </h2>
      <p className="mb-4 text-xs text-neutral-500">
        {monthLabel(selectedDate)}
      </p>

      {/* Horizontal day strip — thumb-friendly and avoids a full calendar on mobile. */}
      <div
        className="-mx-5 mb-6 flex snap-x [scrollbar-width:none] gap-2 overflow-x-auto px-5 pb-2 [&::-webkit-scrollbar]:hidden"
        role="radiogroup"
        aria-label="בחירת יום"
      >
        {dates.map((date) => {
          const active = date === selectedDate;
          return (
            <button
              key={date}
              ref={active ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelectDate(date)}
              className={cn(
                "flex w-14 shrink-0 snap-center flex-col items-center gap-0.5 rounded-xl border py-2.5 transition-all",
                "focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95",
                active
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
              )}
            >
              <span className="text-[11px] font-medium opacity-70">
                {weekdayLabel(date)}
              </span>
              <span className="text-lg leading-none font-bold">
                {dayOfMonth(date)}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="h-11 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800"
              />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : slots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-200 px-4 py-10 text-center dark:border-neutral-800">
            <CalendarOff className="size-6 text-neutral-300" aria-hidden />
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              אין מועדים פנויים ביום זה
            </p>
            <p className="text-xs text-neutral-500">בחרו יום אחר מהרשימה</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
            role="radiogroup"
            aria-label="בחירת שעה"
          >
            {slots.map((slot) => {
              const active = selectedSlot?.startsAt === slot.startsAt;
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelectSlot(slot)}
                  className={cn(
                    "h-11 rounded-xl border text-sm font-semibold tabular-nums transition-all",
                    "focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95",
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                      : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
                  )}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-500">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          טוען מועדים פנויים…
        </p>
      ) : null}
    </section>
  );
}
