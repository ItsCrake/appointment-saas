"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, MessageCircle, Phone, UserX, X } from "lucide-react";

import { setAppointmentStatusAction } from "@/app/dashboard/actions";
import { useSharedStatus } from "@/components/dashboard/appointment-status-store";
import { useToast } from "@/components/ui/toast";
import {
  focusRing,
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
        // The appointment sheet's glass at list scale: the day and the booking
        // it opens read as one material. A request is edged in the amber the
        // calendar gives it, so the two screens agree about what is waiting.
        "glass-row rounded-3xl p-4",
        awaitingApproval && "glass-row-pending",
      )}
    >
      <div className="flex items-start gap-4">
        {/* The time on its own set-in capsule: it is what an owner scans down a
            day for, so it is the first thing on the row with a shape. */}
        <div
          className={cn(
            "glass-inset shrink-0 rounded-2xl px-3 py-2 text-center",
            !open && "opacity-80",
          )}
        >
          {showDate ? (
            <p className="mb-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              {start.weekday} · {start.date}
            </p>
          ) : null}
          <p
            className={cn(
              "text-lg leading-none font-bold text-zinc-900 tabular-nums dark:text-zinc-100",
              status === "cancelled" && "line-through",
            )}
          >
            {start.time}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">
            {end.time}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* A booking that is not happening is set in zinc rather than
                faded: the old `opacity-70` on the whole row took its secondary
                line under AA. The chip beside it says which of the two. */}
            <p
              className={cn(
                "font-semibold",
                open
                  ? "text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-600 dark:text-zinc-400",
                status === "cancelled" && "line-through",
              )}
            >
              {appointment.clientName}
            </p>
            <StatusChip status={status} />
            {/* On the header row rather than beside the note itself: this row
                is what an owner scans down a list of twenty, and the note is a
                paragraph below it that they only reach if something says to. */}
            <NotesBadge notes={appointment.notes} />
          </div>

          <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
            {appointment.serviceName} · {formatPrice(appointment.priceCents)}
          </p>

          {appointment.notes ? (
            <p className="glass-inset mt-2 rounded-2xl px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
              {appointment.notes}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-xs font-medium text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`tel:${appointment.clientPhone}`}
          className={cn(GLASS_ACTION, "text-zinc-800 dark:text-zinc-200")}
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
            className={cn(
              GLASS_ACTION,
              "text-emerald-800 dark:text-emerald-300",
            )}
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
            className={cn(GLASS_ACTION, "text-zinc-700 dark:text-zinc-300")}
          >
            ביטול השינוי
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Every action on a row is a glass pill, the sheet's own control at a smaller
 * size, so a row of five reads as one set rather than as five bordered boxes
 * each asking for attention. 36px tall: the thumb's floor.
 */
const GLASS_ACTION = cn(
  "glass-control inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold disabled:opacity-60",
  focusRing,
);

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
    // Solid, not glass, and the only solid control in the list. Approving is
    // the one thing on this card that is genuinely being *asked* of the owner
    // rather than merely offered — the same rule the nav and the plan picker
    // follow. emerald-700, because white on emerald-600 measures 3.7:1.
    approve: cn(
      "inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:opacity-60",
      focusRing,
    ),
    brand: cn(GLASS_ACTION, "text-indigo-800 dark:text-indigo-300"),
    red: cn(GLASS_ACTION, "text-red-700 dark:text-red-300"),
    neutral: cn(GLASS_ACTION, "text-zinc-700 dark:text-zinc-300"),
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={tones[tone]}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}
