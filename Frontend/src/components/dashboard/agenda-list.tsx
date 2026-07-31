"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Phone, UserX, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/dashboard/actions";
import { useToast } from "@/components/ui/toast";
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

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתין",
  confirmed: "מאושר",
  completed: "הושלם",
  no_show: "לא הגיע",
  cancelled: "בוטל",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  confirmed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  completed:
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  no_show: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  cancelled:
    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
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

  function update(next: string) {
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
        "rounded-2xl border border-neutral-200 bg-white p-4 transition-opacity dark:border-neutral-800 dark:bg-neutral-900",
        !open && "opacity-70",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <p className="text-lg leading-none font-bold text-neutral-900 tabular-nums dark:text-neutral-100">
            {start.time}
          </p>
          <p className="mt-1 text-[11px] text-neutral-400 tabular-nums">
            {end.time}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">
              {appointment.clientName}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                STATUS_STYLE[status],
              )}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>

          <p className="mt-0.5 truncate text-sm text-neutral-500">
            {appointment.serviceName} · {formatPrice(appointment.priceCents)}
          </p>

          {appointment.notes ? (
            <p className="mt-1.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
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
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <Phone className="size-3.5" aria-hidden />
          <span dir="ltr">{appointment.clientPhone}</span>
        </a>

        {open ? (
          <>
            <QuickAction
              onClick={() => update("completed")}
              disabled={pending}
              tone="emerald"
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
            className="h-9 rounded-lg px-3 text-xs font-semibold text-neutral-500 transition-colors hover:text-neutral-900 disabled:opacity-60 dark:hover:text-neutral-100"
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
  tone: "emerald" | "red" | "neutral";
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
}) {
  const tones = {
    emerald:
      "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
    red: "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40",
    neutral:
      "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800",
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
