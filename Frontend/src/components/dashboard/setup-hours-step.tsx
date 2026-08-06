"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { SetupShift } from "./setup-flow";

const WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

const TIME_FIELD =
  "h-10 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800";

export function SetupHoursStep({
  shifts: initial,
  timezone,
  pending,
  onBack,
  onSubmit,
}: {
  shifts: SetupShift[];
  timezone: string;
  pending: boolean;
  onBack: () => void;
  onSubmit: (shifts: SetupShift[]) => void;
}) {
  const [shifts, setShifts] = useState<SetupShift[]>(initial);

  function addShift(weekday: number) {
    setShifts((prev) => [
      ...prev,
      { weekday, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  function update(index: number, patch: Partial<SetupShift>) {
    setShifts((prev) =>
      prev.map((shift, i) => (i === index ? { ...shift, ...patch } : shift)),
    );
  }

  function remove(index: number) {
    setShifts((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="mb-4 rounded-xl bg-neutral-50 px-4 py-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
        התחלנו עם ראשון–חמישי, 09:00–17:00. יום ללא משמרות נחשב סגור, ושתי
        משמרות באותו יום יוצרות הפסקה ביניהן. אזור זמן: {timezone}
      </p>

      <ul className="space-y-2">
        {WEEKDAYS.map((label, weekday) => {
          const dayShifts = shifts
            .map((shift, index) => ({ shift, index }))
            .filter(({ shift }) => shift.weekday === weekday);

          return (
            <li
              key={label}
              className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {label}
                </span>
                <button
                  type="button"
                  onClick={() => addShift(weekday)}
                  className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400"
                >
                  <Plus className="size-3" aria-hidden />
                  משמרת
                </button>
              </div>

              {dayShifts.length === 0 ? (
                <p className="text-xs text-neutral-400">סגור</p>
              ) : (
                <div className="space-y-2">
                  {dayShifts.map(({ shift, index }) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="time"
                        dir="ltr"
                        aria-label={`${label} — שעת התחלה`}
                        value={shift.startTime}
                        onChange={(e) =>
                          update(index, { startTime: e.target.value })
                        }
                        className={TIME_FIELD}
                      />
                      <span className="text-xs text-neutral-400">עד</span>
                      <input
                        type="time"
                        dir="ltr"
                        aria-label={`${label} — שעת סיום`}
                        value={shift.endTime}
                        onChange={(e) =>
                          update(index, { endTime: e.target.value })
                        }
                        className={TIME_FIELD}
                      />
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label="הסרת משמרת"
                        className="rounded-lg border border-neutral-200 p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-neutral-700"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(shifts)}
          disabled={pending}
          className="h-12 flex-1 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60"
        >
          המשך לסיום
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-12 rounded-xl border border-neutral-300 px-5 text-sm font-semibold text-neutral-700 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
        >
          חזרה
        </button>
      </div>
    </div>
  );
}
