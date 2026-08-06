"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  createTimeOffAction,
  deleteTimeOffAction,
  saveWorkingHoursAction,
} from "@/app/dashboard/hours/actions";
import { formatFullDateTime } from "@/lib/format";

type Shift = { weekday: number; startTime: string; endTime: string };

type TimeOffEntry = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

const WEEKDAYS = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
] as const;

export function HoursManager({
  shifts: initialShifts,
  timeOff,
  timezone,
}: {
  shifts: Shift[];
  timeOff: TimeOffEntry[];
  timezone: string;
}) {
  const [shifts, setShifts] = useState<Shift[]>(initialShifts);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function addShift(weekday: number) {
    setSaved(false);
    setShifts((prev) => [
      ...prev,
      { weekday, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  function updateShift(index: number, patch: Partial<Shift>) {
    setSaved(false);
    setShifts((prev) =>
      prev.map((shift, i) => (i === index ? { ...shift, ...patch } : shift)),
    );
  }

  function removeShift(index: number) {
    setSaved(false);
    setShifts((prev) => prev.filter((_, i) => i !== index));
  }

  function save() {
    setError(undefined);
    setSaved(false);

    startTransition(async () => {
      const result = await saveWorkingHoursAction(shifts);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          שעות שבועיות
        </h2>
        <p className="mb-4 text-xs text-neutral-500">
          יום ללא משמרות נחשב סגור. שתי משמרות באותו יום יוצרות הפסקה ביניהן.
        </p>

        <ul className="space-y-3">
          {WEEKDAYS.map((label, weekday) => {
            const dayShifts = shifts
              .map((shift, index) => ({ shift, index }))
              .filter(({ shift }) => shift.weekday === weekday);

            return (
              <li
                key={label}
                className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {label}
                  </span>
                  <button
                    type="button"
                    onClick={() => addShift(weekday)}
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
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
                            updateShift(index, { startTime: e.target.value })
                          }
                          className="h-10 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
                        />
                        <span className="text-xs text-neutral-400">עד</span>
                        <input
                          type="time"
                          dir="ltr"
                          aria-label={`${label} — שעת סיום`}
                          value={shift.endTime}
                          onChange={(e) =>
                            updateShift(index, { endTime: e.target.value })
                          }
                          className="h-10 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
                        />
                        <button
                          type="button"
                          onClick={() => removeShift(index)}
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

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="mt-3 text-sm font-medium text-emerald-600"
          >
            השעות נשמרו
          </p>
        ) : null}

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          שמירת שעות
        </button>
      </section>

      <TimeOffSection entries={timeOff} timezone={timezone} />
    </div>
  );
}

function TimeOffSection({
  entries,
  timezone,
}: {
  entries: TimeOffEntry[];
  timezone: string;
}) {
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("13:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function add() {
    setError(undefined);
    if (!date) {
      setError("יש לבחור תאריך");
      return;
    }

    startTransition(async () => {
      const result = await createTimeOffAction({
        date,
        startTime,
        endTime,
        reason,
      });
      if (result.ok) {
        setDate("");
        setReason("");
      } else {
        setError(result.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteTimeOffAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        חסימות וחופשות
      </h2>
      <p className="mb-4 text-xs text-neutral-500">
        חוסם מועדים בתאריך מסוים מבלי לשנות את השעות הקבועות.
      </p>

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              תאריך
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              משעה
            </span>
            <input
              type="time"
              dir="ltr"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              עד שעה
            </span>
            <input
              type="time"
              dir="ltr"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
              סיבה
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="חופשה"
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-800 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
          הוספת חסימה
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {entries.map((entry) => {
          const from = formatFullDateTime(entry.startsAt, timezone);
          const to = formatFullDateTime(entry.endsAt, timezone);
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {from.date} · {from.time}–{to.time}
                </p>
                {entry.reason ? (
                  <p className="truncate text-xs text-neutral-500">
                    {entry.reason}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                disabled={pending}
                aria-label="מחיקת חסימה"
                className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-neutral-700"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-xs text-neutral-500 dark:border-neutral-800">
          אין חסימות עתידיות
        </p>
      ) : null}
    </section>
  );
}
