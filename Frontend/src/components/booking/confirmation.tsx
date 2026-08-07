"use client";

import Link from "next/link";
import {
  CalendarPlus,
  Check,
  CalendarCheck,
  Phone,
  Tag,
  User,
  ShieldCheck,
} from "lucide-react";

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
    <section
      className="animate-step px-5 pb-8"
      aria-labelledby="confirm-heading"
    >
      <div className="rounded-3xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-6 text-center dark:border-emerald-900 dark:from-emerald-950/40 dark:to-zinc-950">
        <div
          aria-hidden
          className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/25"
        >
          <Check className="size-7" strokeWidth={3} />
        </div>

        <h2
          id="confirm-heading"
          className="text-xl font-bold text-emerald-900 dark:text-emerald-100"
        >
          התור נקבע בהצלחה!
        </h2>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-200/70">
          נתראה ב{appointment.businessName}
        </p>

        {/* The date and time, large. This is the one fact worth remembering. */}
        <p className="mt-4 text-2xl font-bold text-zinc-900 tabular-nums dark:text-zinc-50">
          {when.time}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          יום {when.weekday}, {when.date}
        </p>
      </div>

      <dl className="mt-4 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        <Row
          icon={<CalendarCheck className="size-4" aria-hidden />}
          label="שירות"
        >
          {appointment.serviceName}
        </Row>
        <Row icon={<Tag className="size-4" aria-hidden />} label="מחיר">
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
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm font-semibold text-(--accent-contrast) shadow-sm transition-all hover:bg-(--accent-strong) hover:shadow-md focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.99]"
      >
        <CalendarPlus className="size-4" aria-hidden />
        הוספה ליומן
      </button>

      {/* The cancel link is the client's only handle on this booking once they
          close the tab, so it gets a full-width control and an explanation
          rather than a quiet text link. */}
      <Link
        href={`/b/${appointment.cancelToken}`}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <ShieldCheck className="size-4" aria-hidden />
        צפייה או ביטול התור
      </Link>

      <p className="mt-2.5 text-center text-xs leading-relaxed text-zinc-500">
        שמרו את הקישור הזה — דרכו תוכלו לבטל את התור בעצמכם.
      </p>

      <button
        type="button"
        onClick={onBookAnother}
        className="mt-4 h-12 w-full rounded-xl text-sm font-semibold text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-none dark:hover:text-zinc-100"
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
