"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { createManualBookingAction } from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/format";

type ServiceOption = { id: string; name: string; durationMin: number };

export function ManualBookingDialog({
  date,
  services,
  onClose,
  onCreated,
}: {
  date: string;
  services: ServiceOption[];
  onClose: () => void;
  /**
   * Refreshing has to happen in the parent: calling router.refresh() from this
   * component's transition loses the update when the dialog unmounts.
   */
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [bookingDate, setBookingDate] = useState(date);
  const [time, setTime] = useState("10:00");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await createManualBookingAction({
        serviceId,
        date: bookingDate,
        time,
        clientName,
        clientPhone,
        notes,
      });

      if (result.ok) {
        toast("התור נוסף ליומן");
        onCreated();
      } else {
        setError(result.error);
      }
    });
  }

  if (services.length === 0) {
    return (
      <Backdrop onClose={onClose}>
        <div
          ref={dialogRef}
          className="w-full max-w-md rounded-2xl bg-white p-6 text-center dark:bg-neutral-900"
        >
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            צריך להגדיר לפחות שירות אחד לפני הוספת תור ידני.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 h-10 w-full rounded-xl border border-neutral-300 text-sm font-semibold dark:border-neutral-700"
          >
            סגירה
          </button>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop onClose={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-booking-title"
        className="animate-step max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="manual-booking-title"
            className="text-base font-bold text-neutral-900 dark:text-neutral-100"
          >
            תור ידני
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="rounded-lg p-1 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="mb-4 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800">
          תור ידני נוצר גם מחוץ לשעות הפעילות. חפיפה עם תור קיים תיחסם.
        </p>

        <form onSubmit={submit} noValidate className="space-y-3">
          <Field label="שירות" htmlFor="mb-service">
            <select
              id="mb-service"
              ref={firstFieldRef}
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className={FIELD}
            >
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {formatDuration(service.durationMin)}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך" htmlFor="mb-date">
              <input
                id="mb-date"
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                className={FIELD}
              />
            </Field>
            <Field label="שעה" htmlFor="mb-time">
              <input
                id="mb-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={`${FIELD} tabular-nums`}
              />
            </Field>
          </div>

          <Field label="שם הלקוח" htmlFor="mb-name">
            <input
              id="mb-name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="ישראל ישראלי"
              className={FIELD}
            />
          </Field>

          <Field label="טלפון" htmlFor="mb-phone">
            <input
              id="mb-phone"
              type="tel"
              dir="ltr"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="050-1234567"
              className={`${FIELD} text-start`}
            />
          </Field>

          <Field label="הערות (לא חובה)" htmlFor="mb-notes">
            <input
              id="mb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              הוספת התור
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-11 rounded-xl border border-neutral-300 px-4 text-sm font-semibold text-neutral-700 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </Backdrop>
  );
}

const FIELD =
  "h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

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
      <span className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}
