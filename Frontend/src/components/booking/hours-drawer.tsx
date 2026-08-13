"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { BookingHours } from "./types";

const WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

/** "09:00:00" → "09:00". The column is a `time`, so seconds always ride along. */
const hhmm = (value: string) => value.slice(0, 5);

type DayHours = { weekday: number; shifts: string[] };

/**
 * One row per weekday, always seven, so a closed day is stated rather than
 * missing. Multiple rows on a weekday are a split shift and stay separate.
 */
function toWeek(hours: BookingHours[]): DayHours[] {
  return WEEKDAYS.map((_, weekday) => ({
    weekday,
    shifts: hours
      .filter((h) => h.weekday === weekday && !h.isClosed)
      .map((h) => `${hhmm(h.startTime)}–${hhmm(h.endTime)}`),
  }));
}

export function HoursDrawer({
  hours,
  todayWeekday,
}: {
  hours: BookingHours[];
  todayWeekday: number;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape to close, and lock the background so the sheet does not scroll the
  // page behind it on iOS.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (hours.length === 0) return null;

  const week = toWeek(hours);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100/80 px-3 py-1.5 text-xs font-medium text-zinc-500 ring-1 ring-zinc-900/5 transition-colors ring-inset hover:bg-zinc-200/80 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:bg-zinc-800/60 dark:ring-white/10 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100"
      >
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        שעות פעילות
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="סגירה"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="animate-fade absolute inset-0 cursor-default bg-black/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="animate-sheet relative w-full max-w-lg rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-zinc-900"
          >
            <div
              aria-hidden
              className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"
            />

            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2
                id={titleId}
                className="text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                שעות פעילות
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגירה"
                className="-me-2 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <dl className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto px-5 pb-6 dark:divide-zinc-800">
              {week.map(({ weekday, shifts }) => {
                const isToday = weekday === todayWeekday;

                return (
                  <div
                    key={weekday}
                    className={cn(
                      "flex items-start justify-between gap-4 py-3 text-sm",
                      isToday && "font-semibold",
                    )}
                  >
                    <dt
                      className={cn(
                        "flex items-center gap-2",
                        isToday
                          ? "text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-600 dark:text-zinc-400",
                      )}
                    >
                      {WEEKDAYS[weekday]}
                      {isToday ? (
                        <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                          היום
                        </span>
                      ) : null}
                    </dt>

                    <dd
                      className={cn(
                        "text-end tabular-nums",
                        shifts.length === 0
                          ? "text-zinc-400"
                          : "text-zinc-900 dark:text-zinc-100",
                      )}
                    >
                      {shifts.length === 0 ? (
                        "סגור"
                      ) : (
                        <span
                          dir="ltr"
                          className="inline-flex flex-col gap-0.5"
                        >
                          {shifts.map((shift) => (
                            <span key={shift}>{shift}</span>
                          ))}
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}
