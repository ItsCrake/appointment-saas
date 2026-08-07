"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Phone, UserX, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
import {
  STATUS_LABEL,
  StatusChip,
  type AppointmentStatusName,
} from "@/components/dashboard/ui";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AgendaAppointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  priceCents: number;
  notes: string | null;
};

export function AgendaList({
  appointments,
  timezone,
}: {
  appointments: AgendaAppointment[];
  timezone: string;
}) {
  return (
    <ul className="space-y-3">
      {appointments.map((appointment) => (
        <AgendaRow
          key={appointment.id}
          appointment={appointment}
          timezone={timezone}
        />
      ))}
    </ul>
  );
}

function AgendaRow({
  appointment,
  timezone,
}: {
  appointment: AgendaAppointment;
  timezone: string;
}) {
  const [status, setStatus] = useState(appointment.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const { toast } = useToast();

  const start = formatFullDateTime(appointment.startsAt, timezone);
  const end = formatFullDateTime(appointment.endsAt, timezone);
  const open = status === "confirmed" || status === "pending";

  function update(next: AppointmentStatusName) {
    const previous = status;
    setStatus(next); // optimistic
    setError(undefined);

    startTransition(async () => {
      const result = await setAppointmentStatusAction(appointment.id, next);
      if (result.ok) {
        toast(`${appointment.clientName}: ${STATUS_LABEL[next]}`);
      } else {
        setStatus(previous); // roll back
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  return (
    <li
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-4 transition-opacity dark:border-zinc-800 dark:bg-zinc-900",
        !open && "opacity-70",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <p className="text-lg leading-none font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
            {start.time}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400 tabular-nums">
            {end.time}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
              {appointment.clientName}
            </p>
            <StatusChip status={status} />
          </div>

          <p className="mt-0.5 truncate text-sm text-zinc-500">
            {appointment.serviceName} · {formatPrice(appointment.priceCents)}
          </p>

          {appointment.notes ? (
            <p className="mt-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {appointment.notes}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`tel:${appointment.clientPhone}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Phone className="size-3.5" aria-hidden />
          <span dir="ltr">{appointment.clientPhone}</span>
        </a>

        {open ? (
          <>
            <QuickAction
              onClick={() => update("completed")}
              disabled={pending}
              tone="brand"
              icon={<Check className="size-3.5" aria-hidden />}
              label="הושלם"
              busy={pending}
            />
            <QuickAction
              onClick={() => update("no_show")}
              disabled={pending}
              tone="neutral"
              icon={<UserX className="size-3.5" aria-hidden />}
              label="לא הגיע"
            />
            <QuickAction
              onClick={() => update("cancelled")}
              disabled={pending}
              tone="red"
              icon={<X className="size-3.5" aria-hidden />}
              label="ביטול"
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => update("confirmed")}
            disabled={pending}
            className="h-9 rounded-lg px-3 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-60 dark:hover:text-zinc-100"
          >
            ביטול השינוי
          </button>
        )}
      </div>
    </li>
  );
}

function QuickAction({
  onClick,
  disabled,
  tone,
  icon,
  label,
  busy,
}: {
  onClick: () => void;
  disabled: boolean;
  tone: "brand" | "red" | "neutral";
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
}) {
  const tones = {
    brand:
      "border-indigo-200 text-indigo-800 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40",
    red: "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40",
    neutral:
      "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-60",
        tones[tone],
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}
