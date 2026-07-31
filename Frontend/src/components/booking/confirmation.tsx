"use client";

import Link from "next/link";
import { CalendarPlus, Check, CalendarCheck, Phone, User } from "lucide-react";

import type { BookingConfirmation } from "@/app/[slug]/actions";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { buildIcs, downloadIcs } from "@/lib/ics";

type Props = {
  appointment: BookingConfirmation;
  onBookAnother: () => void;
};

export function Confirmation({ appointment, onBookAnother }: Props) {
  const when = formatFullDateTime(
    appointment.startsAt,
    appointment.businessTimezone,
  );

  function addToCalendar() {
    const ics = buildIcs({
      uid: `${appointment.id}@appointment-saas`,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      title: `${appointment.serviceName} — ${appointment.businessName}`,
      description: `תור ב${appointment.businessName}`,
      location: appointment.businessName,
    });
    downloadIcs(`appointment-${appointment.id.slice(0, 8)}`, ics);
  }

  return (
    <section className="animate-step px-5" aria-labelledby="confirm-heading">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
        <div
          aria-hidden
          className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white"
        >
          <Check className="size-6" strokeWidth={3} />
        </div>

        <h2
          id="confirm-heading"
          className="text-lg font-bold text-emerald-900 dark:text-emerald-100"
        >
          התור נקבע בהצלחה!
        </h2>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
          נתראה ב{appointment.businessName}
        </p>
      </div>

      <dl className="mt-4 divide-y divide-neutral-200 rounded-2xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
        <Row
          icon={<CalendarCheck className="size-4" aria-hidden />}
          label="מועד"
        >
          יום {when.weekday}, {when.date} בשעה{" "}
          <span className="font-semibold tabular-nums">{when.time}</span>
        </Row>
        <Row label="שירות">
          {appointment.serviceName} ·{" "}
          {formatPrice(appointment.priceCents, appointment.currency)}
        </Row>
        <Row icon={<User className="size-4" aria-hidden />} label="שם">
          {appointment.clientName}
        </Row>
        <Row icon={<Phone className="size-4" aria-hidden />} label="טלפון">
          <span dir="ltr">{appointment.clientPhone}</span>
        </Row>
      </dl>

      <button
        type="button"
        onClick={addToCalendar}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:bg-neutral-100 dark:text-neutral-900"
      >
        <CalendarPlus className="size-4" aria-hidden />
        הוספה ליומן
      </button>

      <Link
        href={`/b/${appointment.cancelToken}`}
        className="mt-3 flex h-12 w-full items-center justify-center rounded-xl border border-neutral-300 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        צפייה או ביטול התור
      </Link>

      <button
        type="button"
        onClick={onBookAnother}
        className="mt-3 h-12 w-full rounded-xl text-sm font-semibold text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none dark:hover:text-neutral-100"
      >
        קביעת תור נוסף
      </button>
    </section>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <dt className="flex min-w-20 items-center gap-2 text-sm text-neutral-500">
        {icon}
        {label}
      </dt>
      <dd className="flex-1 text-sm text-neutral-900 dark:text-neutral-100">
        {children}
      </dd>
    </div>
  );
}
