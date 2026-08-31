"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { createManualBookingAction } from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import { formatDuration } from "@/lib/format";

type ServiceOption = { id: string; name: string; durationMin: number };
type StaffOption = { id: string; name: string };

export function ManualBookingDialog({
  date,
  services,
  staff,
  onClose,
  onCreated,
}: {
  date: string;
  services: ServiceOption[];
  /**
   * Who this booking may be assigned to.
   *
   * The action has always accepted a `staffId` and resolved it through the
   * business; nothing here offered one, so every manual booking silently went
   * to `getDefaultStaff` — the head of the roster. On a team that is a booking
   * quietly given to whoever happens to sort first, which the owner then finds
   * on the wrong person's column.
   */
  staff: StaffOption[];
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
  // Defaults to the first provider, which is exactly who the server would have
  // picked anyway — so the field starts by *showing* the existing behaviour
  // rather than changing it.
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [bookingDate, setBookingDate] = useState(date);
  const [time, setTime] = useState("10:00");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
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
        staffId,
        date: bookingDate,
        time,
        clientName,
        clientPhone,
        clientEmail,
        notes,
      });

      if (result.ok) {
        // A booking with no reachable client is still a booking, so this is a
        // warning rather than an error — but it is said out loud. Silently
        // sending nothing is what made owners think confirmations were broken.
        if (result.warning) toast(result.warning, "error");
        else toast("התור נוסף ליומן והאישור נשלח ללקוח");
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
          className="w-full max-w-md rounded-2xl bg-white p-6 text-center dark:bg-zinc-900"
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            צריך להגדיר לפחות שירות אחד לפני הוספת תור ידני.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 h-10 w-full rounded-xl border border-zinc-300 text-sm font-semibold dark:border-zinc-700"
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
        className="animate-step max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="manual-booking-title"
            className="text-base font-bold text-zinc-900 dark:text-zinc-100"
          >
            תור ידני
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="rounded-lg p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800">
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

          {/* Rendered whenever anybody can take it, not only for a team — the
              same rule the move dialog now follows. With one provider it says
              who the booking is going to; with several it is the only place the
              owner gets to decide. */}
          {staff.length > 0 ? (
            <Field label="נותן שירות" htmlFor="mb-staff">
              <select
                id="mb-staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className={FIELD}
              >
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

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
                dir="ltr"
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

          <Field label="אימייל (לאישור ותזכורת)" htmlFor="mb-email">
            <input
              id="mb-email"
              type="email"
              dir="ltr"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="you@example.com"
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
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60"
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
              className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
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
  "h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-zinc-950 dark:focus:ring-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

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
      <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
