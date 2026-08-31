"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, MessageCircle, Phone, UserX, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/dashboard/actions";
import { useSharedStatus } from "@/components/dashboard/appointment-status-store";
import { useToast } from "@/components/ui/toast";
import {
  NotesBadge,
  STATUS_LABEL,
  StatusChip,
  type AppointmentStatusName,
} from "@/components/dashboard/ui";
import { formatFullDateTime, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { whatsappHref } from "@/lib/whatsapp-link";

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
  showDate = false,
}: {
  appointments: AgendaAppointment[];
  timezone: string;
  /** For lists that span days — the agenda itself is already one date. */
  showDate?: boolean;
}) {
  return (
    <ul className="space-y-3">
      {appointments.map((appointment) => (
        <AgendaRow
          key={appointment.id}
          appointment={appointment}
          timezone={timezone}
          showDate={showDate}
        />
      ))}
    </ul>
  );
}

function AgendaRow({
  appointment,
  timezone,
  showDate,
}: {
  appointment: AgendaAppointment;
  timezone: string;
  showDate?: boolean;
}) {
  /**
   * Shared rather than local: this row can be on screen twice — once in the
   * pending panel, once in the day's agenda — and two copies of one booking
   * disagreeing about whether it is approved is the bug this replaces.
   */
  const [status, setStatus] = useSharedStatus(
    appointment.id,
    appointment.status,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const { toast } = useToast();

  const start = formatFullDateTime(appointment.startsAt, timezone);
  const end = formatFullDateTime(appointment.endsAt, timezone);
  const waHref = whatsappHref(appointment.clientPhone);
  const open = status === "confirmed" || status === "pending";
  /** A request the owner has not answered yet — see `requires_approval`. */
  const awaitingApproval = status === "pending";

  function update(next: AppointmentStatusName) {
    const previous = status as AppointmentStatusName;
    setStatus(next); // optimistic
    setError(undefined);

    startTransition(async () => {
      const result = await setAppointmentStatusAction(appointment.id, next);
      if (result.ok) {
        /**
         * **Cancelling is the one status change that gets a way back.**
         *
         * It is the only one that tells the client something — the cancellation
         * message goes out on the same click — and the only one an owner can
         * make by hitting the wrong row on a phone and not notice for a week.
         * "Completed" on the wrong appointment is a tidy-up; "cancelled" on the
         * wrong appointment is somebody turning up to a closed shop.
         */
        toast(
          `${appointment.clientName}: ${STATUS_LABEL[next]}`,
          next === "cancelled"
            ? { action: { label: "בטל פעולה", onAct: () => restore(previous) } }
            : undefined,
        );
      } else {
        setStatus(previous); // roll back
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  /**
   * Puts the appointment back where it was.
   *
   * Deliberately restores the *previous* status rather than assuming
   * `confirmed`: a rejected request came from `pending`, and promoting it to
   * confirmed would agree to something on the owner's behalf.
   */
  function restore(previous: AppointmentStatusName) {
    setStatus(previous); // optimistic, same as the change it is undoing
    setError(undefined);

    startTransition(async () => {
      const result = await setAppointmentStatusAction(appointment.id, previous);
      if (result.ok) {
        toast(`${appointment.clientName}: ${STATUS_LABEL[previous]}`);
      } else {
        setStatus("cancelled");
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
          {showDate ? (
            <p className="mb-1 text-[11px] font-medium text-zinc-500">
              {start.weekday} · {start.date}
            </p>
          ) : null}
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
            {/* On the header row rather than beside the note itself: this row
                is what an owner scans down a list of twenty, and the note is a
                paragraph below it that they only reach if something says to. */}
            <NotesBadge notes={appointment.notes} />
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

        {/**
         * Calling was the only way to reach a client from this card, and it is
         * the one owners use least — a barber mid-cut cannot take a call, and
         * "running ten minutes late" is a message, not a conversation.
         *
         * Ungated, unlike `canSendWhatsapp`. That entitlement covers messages
         * *this system* sends through the API, which cost us per tenant; this
         * opens the owner's own WhatsApp and costs nothing, exactly as the
         * waitlist manager's button already does.
         *
         * Absent rather than broken when the number is unusable — a manual
         * booking is allowed to carry no phone at all.
         */}
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            שליחת וואטסאפ
            <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
          </a>
        ) : null}

        {/* A request has exactly two useful answers, and they are not the same
            two as a booking's. Showing "הושלם" beside something the owner has
            not agreed to yet buries the decision among actions that make no
            sense until it is made. */}
        {awaitingApproval ? (
          <>
            <QuickAction
              onClick={() => update("confirmed")}
              disabled={pending}
              tone="approve"
              icon={<Check className="size-3.5" aria-hidden />}
              label="אישור התור"
              busy={pending}
            />
            <QuickAction
              onClick={() => update("cancelled")}
              disabled={pending}
              tone="red"
              icon={<X className="size-3.5" aria-hidden />}
              label="דחייה"
            />
          </>
        ) : open ? (
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
  tone: "brand" | "red" | "neutral" | "approve";
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
}) {
  const tones = {
    // Filled, not outlined, and the only filled control in the list. Approving
    // is the one thing on this card that is genuinely being *asked* of the
    // owner rather than merely offered — the same rule the nav and the plan
    // picker follow.
    approve:
      "border-transparent bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
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
