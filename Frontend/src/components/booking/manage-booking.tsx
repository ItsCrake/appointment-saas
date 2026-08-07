"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarCheck,
  CalendarPlus,
  Loader2,
  MapPin,
  Phone,
  Tag,
  User,
  XCircle,
} from "lucide-react";

import { cancelBookingAction } from "@/app/b/[token]/actions";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { buildIcs, downloadIcs } from "@/lib/ics";

type Appointment = {
  id: string;
  status: string;
  serviceName: string;
  priceCents: number;
  startsAt: string;
  endsAt: string;
  clientName: string;
  clientPhone: string;
  notes: string | null;
};

type Business = {
  name: string;
  slug: string;
  timezone: string;
  phone: string | null;
  address: string | null;
  cancelWindowHours: number;
};

export function ManageBooking({
  token,
  appointment,
  business,
  canCancel,
  isPast,
}: {
  token: string;
  appointment: Appointment;
  business: Business;
  canCancel: boolean;
  /** Evaluated on the server — comparing to Date.now() in render would risk a
   *  hydration mismatch. */
  isPast: boolean;
}) {
  const [status, setStatus] = useState(appointment.status);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const when = formatFullDateTime(appointment.startsAt, business.timezone);
  const cancelled = status === "cancelled";
  const past = isPast;

  async function cancel() {
    setPending(true);
    setError(undefined);

    const result = await cancelBookingAction(token);

    setPending(false);
    if (result.ok) {
      setStatus("cancelled");
      setConfirming(false);
    } else {
      setError(result.error);
    }
  }

  function addToCalendar() {
    const ics = buildIcs({
      uid: `${appointment.id}@appointment-saas`,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      title: `${appointment.serviceName} — ${business.name}`,
      description: business.phone
        ? `תור ב${business.name}. לשאלות: ${business.phone}`
        : `תור ב${business.name}`,
      location: business.address ?? business.name,
    });
    downloadIcs(`appointment-${appointment.id.slice(0, 8)}`, ics);
  }

  return (
    <main>
      <header className="mb-6 text-center">
        <div
          aria-hidden
          className={`mx-auto mb-3 flex size-14 items-center justify-center rounded-full ${
            cancelled
              ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"
              : "bg-emerald-600 text-white"
          }`}
        >
          {cancelled ? (
            <XCircle className="size-7" />
          ) : (
            <CalendarCheck className="size-7" />
          )}
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {cancelled ? "התור בוטל" : "התור שלך"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{business.name}</p>
      </header>

      <dl className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <Row
          icon={<CalendarCheck className="size-4" aria-hidden />}
          label="מועד"
        >
          <span className={cancelled ? "line-through opacity-60" : undefined}>
            יום {when.weekday}, {when.date} בשעה{" "}
            <span className="font-semibold tabular-nums">{when.time}</span>
          </span>
        </Row>
        <Row icon={<Tag className="size-4" aria-hidden />} label="שירות">
          {appointment.serviceName} · {formatPrice(appointment.priceCents)}
        </Row>
        <Row icon={<User className="size-4" aria-hidden />} label="שם">
          {appointment.clientName}
        </Row>
        <Row icon={<Phone className="size-4" aria-hidden />} label="טלפון">
          <span dir="ltr">{appointment.clientPhone}</span>
        </Row>
        {business.address ? (
          <Row icon={<MapPin className="size-4" aria-hidden />} label="כתובת">
            {business.address}
          </Row>
        ) : null}
      </dl>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {!cancelled && !past ? (
          <button
            type="button"
            onClick={addToCalendar}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-zinc-100 dark:text-zinc-900"
          >
            <CalendarPlus className="size-4" aria-hidden />
            הוספה ליומן
          </button>
        ) : null}

        {cancelled ? (
          <Link
            href={`/${business.slug}`}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            קביעת תור חדש
          </Link>
        ) : canCancel ? (
          confirming ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
              <p className="mb-3 text-center text-sm font-medium text-red-900 dark:text-red-200">
                לבטל את התור? הפעולה אינה הפיכה.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  disabled={pending}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      מבטל…
                    </>
                  ) : (
                    "כן, בטלו את התור"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="h-11 flex-1 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  השארת התור
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="h-12 w-full rounded-xl border border-zinc-300 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-zinc-700 dark:hover:bg-red-950/30"
            >
              ביטול התור
            </button>
          )
        ) : !past ? (
          <p className="rounded-xl bg-zinc-100 px-4 py-3 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            ניתן לבטל עד {business.cancelWindowHours} שעות לפני התור.
            {business.phone ? (
              <>
                {" "}
                לביטול מאוחר צרו קשר:{" "}
                <a
                  href={`tel:${business.phone}`}
                  className="font-semibold underline"
                >
                  {business.phone}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </main>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <dt className="flex min-w-20 items-center gap-2 text-sm text-zinc-500">
        {icon}
        {label}
      </dt>
      <dd className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">
        {children}
      </dd>
    </div>
  );
}
