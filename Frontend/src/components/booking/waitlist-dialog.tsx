"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";

import { joinWaitlistAction } from "@/app/[slug]/actions";
import { TIME_WINDOW_LABELS, WEEKDAY_NAMES } from "@/lib/waitlist";
import { cn } from "@/lib/utils";

type ServiceOption = { id: string; name: string };
type TimeWindow = "morning" | "afternoon" | "evening" | "any";

const WINDOWS: TimeWindow[] = ["any", "morning", "afternoon", "evening"];

/**
 * Joining the queue, from the shop's own booking page.
 *
 * ---------------------------------------------------------------------------
 * **Four questions, three of which have a working default.** The person filling
 * this in has already failed to find a slot; asking them to specify a service,
 * a provider, six days and a time band would be charging them for the shop's
 * lack of availability. Name and phone are required because without them there
 * is nobody to call back; everything else defaults to "any", which is both the
 * honest answer for most people and the one that matches the most openings.
 *
 * There is no provider question at all here. Choosing a person is a
 * booking-flow decision and this is a request to get *in* — the column exists
 * for the owner adding somebody who rang up and asked for Dana specifically.
 *
 * Glass, matching the shop's accent, because it opens over their branded page
 * rather than over dashboard chrome.
 * ---------------------------------------------------------------------------
 */
export function WaitlistDialog({
  slug,
  services,
  businessName,
  onClose,
}: {
  slug: string;
  services: ServiceOption[];
  businessName: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    clientName: "",
    clientPhone: "",
    serviceId: "",
    notes: "",
  });
  const [days, setDays] = useState<number[]>([]);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("any");
  const [error, setError] = useState<string>();
  const [joined, setJoined] = useState(false);
  const [pending, startTransition] = useTransition();

  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function toggleDay(day: number) {
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day],
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await joinWaitlistAction({
        slug,
        clientName: form.clientName,
        clientPhone: form.clientPhone,
        serviceId: form.serviceId,
        preferredDays: days,
        preferredTimeWindow: timeWindow,
        notes: form.notes,
      });

      if (result.ok) setJoined(true);
      else setError(result.error);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-zinc-950/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-title"
        className={cn(
          "animate-sheet relative max-h-[90vh] w-full max-w-md overflow-y-auto",
          "rounded-t-3xl border border-white/60 bg-white/85 p-5 shadow-2xl backdrop-blur-xl",
          "pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:rounded-3xl sm:pb-5",
          "dark:border-white/10 dark:bg-zinc-900/85",
        )}
      >
        {joined ? (
          <div className="py-4 text-center">
            <span
              aria-hidden
              className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-(--accent-soft) text-(--accent-on-soft)"
            >
              <CheckCircle2 className="size-6" />
            </span>
            <h2
              id="waitlist-title"
              className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
            >
              אתם ברשימה
            </h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              ברגע שיתפנה תור שמתאים למה שביקשתם, {businessName} ישלחו לכם
              הודעה עם קישור לתפיסת המקום.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full rounded-full bg-(--accent) text-sm font-bold text-(--accent-contrast) transition-opacity hover:opacity-90"
            >
              סגירה
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="waitlist-title"
                  className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
                >
                  רשימת המתנה
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  נודיע לכם ברגע שיתפנה תור שמתאים לכם.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="סגירה"
                className="-me-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <form onSubmit={submit} noValidate className="space-y-3">
              <Field label="שם מלא" htmlFor="wl-name">
                <input
                  id="wl-name"
                  ref={firstFieldRef}
                  value={form.clientName}
                  onChange={(e) =>
                    setForm({ ...form, clientName: e.target.value })
                  }
                  placeholder="ישראל ישראלי"
                  className={FIELD}
                />
              </Field>

              <Field label="טלפון" htmlFor="wl-phone">
                <input
                  id="wl-phone"
                  type="tel"
                  dir="ltr"
                  value={form.clientPhone}
                  onChange={(e) =>
                    setForm({ ...form, clientPhone: e.target.value })
                  }
                  placeholder="050-1234567"
                  className={cn(FIELD, "text-start")}
                />
              </Field>

              {services.length > 1 ? (
                <Field label="שירות" htmlFor="wl-service">
                  <select
                    id="wl-service"
                    value={form.serviceId}
                    onChange={(e) =>
                      setForm({ ...form, serviceId: e.target.value })
                    }
                    className={FIELD}
                  >
                    {/* First, and the default: most people just want in. */}
                    <option value="">כל שירות</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <fieldset>
                <legend className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  ימים מועדפים{" "}
                  <span className="font-normal text-zinc-400">
                    (לא חובה — בלי בחירה נודיע על כל יום)
                  </span>
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_NAMES.map((name, day) => {
                    const on = days.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(day)}
                        aria-pressed={on}
                        className={cn(
                          "h-9 min-w-11 rounded-xl px-2.5 text-xs font-semibold transition-colors",
                          on
                            ? "bg-(--accent) text-(--accent-contrast)"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
                        )}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  שעות מועדפות
                </legend>
                <div className="grid grid-cols-4 gap-1.5">
                  {WINDOWS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setTimeWindow(value)}
                      aria-pressed={timeWindow === value}
                      className={cn(
                        "h-9 rounded-xl px-2 text-xs font-semibold transition-colors",
                        timeWindow === value
                          ? "bg-(--accent) text-(--accent-contrast)"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
                      )}
                    >
                      {TIME_WINDOW_LABELS[value]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Field label="הערה (לא חובה)" htmlFor="wl-notes">
                <input
                  id="wl-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className={FIELD}
                />
              </Field>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--accent) text-base font-bold text-(--accent-contrast) transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : null}
                הצטרפות לרשימה
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const FIELD =
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-(--accent) focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
