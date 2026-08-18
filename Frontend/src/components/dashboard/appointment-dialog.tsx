"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  FileText,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  UserRound,
  UserX,
  X,
} from "lucide-react";

import {
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
  updateAppointmentDetailsAction,
} from "@/app/dashboard/actions";
import { saveClientProfileAction } from "@/app/dashboard/clients/actions";
import { useToast } from "@/components/ui/toast";
import { dayOfMonth, formatPrice, weekdayLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  btnPrimary,
  btnSecondary,
  inputClass,
  STATUS_LABEL,
  StatusChip,
  type AppointmentStatusName,
} from "./ui";
import type { CalendarEntry } from "./week-calendar";

type Tab = "appointment" | "client";

const TABS: { id: Tab; label: string }[] = [
  { id: "appointment", label: "פרטי התור" },
  { id: "client", label: "כרטיס לקוח" },
];

/**
 * One appointment, opened from the calendar.
 *
 * ---------------------------------------------------------------------------
 * **Two tabs, because there are two subjects here and they are not the same
 * object.** The first is *this booking* — when it is, what it is for, what the
 * client asked for, and every action that changes it. The second is *the
 * person*, whose notes belong to them rather than to any one appointment and
 * outlive it: "always late", "prefers the window chair". Keeping them on one
 * scroll made the standing note look like part of today's booking, which is
 * exactly the confusion that gets an owner acting on something nobody asked for
 * this time.
 *
 * The client's notes are editable in place. An owner who has just read "bring
 * the other stylist" should not have to leave the calendar, find the clients
 * page and search a phone number to write it down — the note is saved through
 * the same `saveClientProfileAction` that page uses, so there is one write path
 * and one revalidation.
 *
 * **Every successful move or edit closes the dialog.** The entry it was opened
 * with is a snapshot of the last server render, so a dialog that stayed open
 * past a reschedule would be showing the time the appointment used to be at. A
 * *status* change and a *client note* are the exceptions and deliberately stay
 * open: both are held in local state, neither alters anything else on screen,
 * and both are commonly followed by another action.
 * ---------------------------------------------------------------------------
 */
export function AppointmentDialog({
  entry,
  staff,
  timezone,
  onClose,
  onChanged,
}: {
  /** Always `kind: "appointment"`, so `appointmentId` is non-null. */
  entry: CalendarEntry;
  staff: { id: string; name: string; color: string }[];
  timezone: string;
  onClose: () => void;
  /**
   * Refreshing has to happen in the parent: a `router.refresh()` started inside
   * this component's transition is lost when the dialog unmounts — the same
   * reason `manual-booking-dialog` hands its refresh upward.
   */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("appointment");
  const [mode, setMode] = useState<"view" | "edit" | "move">("view");
  const [status, setStatus] = useState(entry.status ?? "confirmed");
  const [error, setError] = useState<string>();
  /**
   * Held here rather than in the panel so the tab's marker updates the moment
   * a note is saved, and survives switching back and forth.
   */
  const [clientNotes, setClientNotes] = useState(entry.clientProfileNotes ?? "");

  const appointmentId = entry.appointmentId ?? "";
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const open = status === "confirmed" || status === "pending";
  /** A request the owner has not answered yet — see `requires_approval`. */
  const awaitingApproval = status === "pending";

  const phone = entry.clientPhone?.replace(/\D/g, "");
  const wa = phone?.startsWith("0") ? `972${phone.slice(1)}` : phone;

  function changeStatus(next: AppointmentStatusName) {
    const previous = status;
    setStatus(next); // optimistic
    setError(undefined);

    startTransition(async () => {
      const result = await setAppointmentStatusAction(appointmentId, next);
      if (result.ok) {
        toast(`${entry.title}: ${STATUS_LABEL[next]}`);
        onChanged();
      } else {
        setStatus(previous); // roll back
        setError(result.error);
        toast(result.error, "error");
      }
    });
  }

  function show(next: Tab) {
    // Leaving a half-finished edit behind on the other tab would be a trap: the
    // owner comes back to a form they no longer expect to be open.
    setMode("view");
    setError(undefined);
    setTab(next);
  }

  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="appointment-dialog-title"
              className="truncate text-base font-bold text-zinc-900 dark:text-zinc-100"
            >
              {entry.title}
            </h2>
            <StatusChip status={status} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {`יום ${weekdayLabel(entry.date)} ${dayOfMonth(entry.date)}/${month(entry.date)}`}
            <span className="mx-1.5 opacity-50">·</span>
            <span className="tabular-nums" dir="ltr">
              {entry.startTime}–{entry.endTime}
            </span>
          </p>
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className="-me-1 shrink-0 rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/* The same segmented control the calendar's own view switch uses, so the
          two toggles on this screen behave alike. */}
      <div
        role="tablist"
        aria-label="פרטי התור והלקוח"
        className="mb-4 flex items-center gap-1 rounded-full bg-zinc-100 p-1 dark:bg-zinc-800"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`appointment-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`appointment-panel-${id}`}
            onClick={() => show(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
              tab === id
                ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
            )}
          >
            {label}
            {/* A dot on the tab that has something written on it, so an owner
                knows there is a standing note without opening the tab to find
                out. The same job the mark on the calendar card does. */}
            {id === "client" && clientNotes.trim() ? (
              <span
                aria-label="ישנן הערות"
                role="img"
                className="size-1.5 rounded-full bg-amber-500"
              />
            ) : null}
          </button>
        ))}
      </div>

      {tab === "appointment" ? (
        <div
          role="tabpanel"
          id="appointment-panel-appointment"
          aria-labelledby="appointment-tab-appointment"
        >
          <dl className="space-y-1 text-xs">
            {entry.subtitle ? <Row label="שירות">{entry.subtitle}</Row> : null}
            {entry.priceCents !== null ? (
              <Row label="מחיר">{formatPrice(entry.priceCents)}</Row>
            ) : null}
            {entry.staffName ? (
              <Row label="נותן שירות">{entry.staffName}</Row>
            ) : null}
            {entry.clientPhone ? (
              <Row label="טלפון">
                <span dir="ltr">{entry.clientPhone}</span>
              </Row>
            ) : null}
          </dl>

          {/* This booking's note only. What the shop knows about the person
              lives on the other tab, because it is about the person. */}
          {entry.notes?.trim() ? (
            <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800">
              <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-zinc-500">
                <FileText className="size-3" aria-hidden />
                הערת הלקוח לתור הזה
              </p>
              <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                {entry.notes}
              </p>
            </div>
          ) : null}

          {entry.clientPhone ? (
            <div className="mt-3 flex gap-2">
              <a
                href={`tel:${entry.clientPhone}`}
                className={cn(btnSecondary, "h-10 flex-1 px-3 text-xs")}
              >
                <Phone className="size-3.5" aria-hidden />
                חיוג
              </a>
              <a
                href={`https://wa.me/${wa}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(btnSecondary, "h-10 flex-1 px-3 text-xs")}
              >
                <MessageCircle className="size-3.5" aria-hidden />
                וואטסאפ
              </a>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          {mode === "view" ? (
            <>
              {/* A request has exactly two useful answers, and they are not the
                  same two as a booking's — the same rule the agenda follows. */}
              <div className="mt-4 flex flex-wrap gap-2">
                {awaitingApproval ? (
                  <>
                    <Action
                      tone="approve"
                      icon={<Check className="size-3.5" aria-hidden />}
                      label="אישור התור"
                      busy={pending}
                      disabled={pending}
                      onClick={() => changeStatus("confirmed")}
                    />
                    <Action
                      tone="red"
                      icon={<X className="size-3.5" aria-hidden />}
                      label="דחייה"
                      disabled={pending}
                      onClick={() => changeStatus("cancelled")}
                    />
                  </>
                ) : open ? (
                  <>
                    <Action
                      tone="brand"
                      icon={<Check className="size-3.5" aria-hidden />}
                      label="הושלם"
                      busy={pending}
                      disabled={pending}
                      onClick={() => changeStatus("completed")}
                    />
                    <Action
                      tone="neutral"
                      icon={<UserX className="size-3.5" aria-hidden />}
                      label="לא הגיע"
                      disabled={pending}
                      onClick={() => changeStatus("no_show")}
                    />
                    <Action
                      tone="red"
                      icon={<X className="size-3.5" aria-hidden />}
                      label="ביטול התור"
                      disabled={pending}
                      onClick={() => changeStatus("cancelled")}
                    />
                  </>
                ) : (
                  <Action
                    tone="neutral"
                    icon={<Check className="size-3.5" aria-hidden />}
                    label="החזרה לתור פעיל"
                    busy={pending}
                    disabled={pending}
                    onClick={() => changeStatus("confirmed")}
                  />
                )}
              </div>

              {/* Moving a cancelled or finished appointment is not a thing to
                  offer: the action refuses it server-side, and a button that
                  always fails is worse than no button. */}
              <div className="mt-2 flex flex-wrap gap-2">
                <Action
                  tone="neutral"
                  icon={<Pencil className="size-3.5" aria-hidden />}
                  label="עריכת פרטים"
                  disabled={pending}
                  onClick={() => {
                    setError(undefined);
                    setMode("edit");
                  }}
                />
                {open ? (
                  <Action
                    tone="neutral"
                    icon={<CalendarClock className="size-3.5" aria-hidden />}
                    label="העברת התור"
                    disabled={pending}
                    onClick={() => {
                      setError(undefined);
                      setMode("move");
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : null}

          {mode === "edit" ? (
            <EditPanel
              entry={entry}
              appointmentId={appointmentId}
              onCancel={() => setMode("view")}
              onSaved={() => {
                toast("פרטי התור עודכנו");
                onChanged();
                onClose();
              }}
              onError={setError}
            />
          ) : null}

          {mode === "move" ? (
            <MovePanel
              entry={entry}
              appointmentId={appointmentId}
              staff={staff}
              timezone={timezone}
              onCancel={() => setMode("view")}
              onSaved={() => {
                toast("התור הועבר");
                onChanged();
                onClose();
              }}
              onError={setError}
            />
          ) : null}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="appointment-panel-client"
          aria-labelledby="appointment-tab-client"
        >
          <ClientCardPanel
            entry={entry}
            notes={clientNotes}
            onNotesChange={setClientNotes}
            onSaved={onChanged}
          />
        </div>
      )}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The person, not the booking.
 *
 * Keyed on the phone number, which is the identity the whole product already
 * uses — see `client-profiles.ts`. Saved through the clients page's own action,
 * so there is exactly one write path for a client note and one place that
 * decides what revalidates.
 *
 * The dialog stays open on save. This is a note an owner writes *while* looking
 * at the booking that prompted it, and closing the thing they were reading in
 * order to confirm the write would be the wrong reward.
 */
function ClientCardPanel({
  entry,
  notes,
  onNotesChange,
  onSaved,
}: {
  entry: CalendarEntry;
  notes: string;
  onNotesChange: (value: string) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(entry.clientProfileNotes ?? "");
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  const phone = entry.clientPhone;
  const dirty = notes !== saved;

  function save() {
    if (!phone) return;

    startTransition(async () => {
      const result = await saveClientProfileAction({
        clientPhone: phone,
        notes,
      });

      if (result.ok) {
        setSaved(notes);
        toast(result.message ?? "ההערות נשמרו", "success");
        // The mark on every one of this client's cards depends on this, so the
        // grid behind the dialog is refreshed even though the dialog stays up.
        onSaved();
      } else {
        toast(result.error, "error");
      }
    });
  }

  if (!phone) {
    return (
      <p className="rounded-xl bg-zinc-50 px-3 py-3 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-800">
        לתור הזה אין מספר טלפון, והערות על לקוח נשמרות לפי מספר. אפשר להוסיף
        מספר דרך «עריכת פרטים» בלשונית השנייה.
      </p>
    );
  }

  return (
    <div>
      <dl className="space-y-1 text-xs">
        <Row label="לקוח">{entry.title}</Row>
        <Row label="טלפון">
          <span dir="ltr">{phone}</span>
        </Row>
      </dl>

      <label className="mt-3 block" htmlFor="ap-client-notes">
        <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <UserRound className="size-3.5" aria-hidden />
          הערות קבועות על הלקוח
        </span>
        <textarea
          id="ap-client-notes"
          ref={fieldRef}
          rows={5}
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="מעדיף כיסא ליד החלון, רגיש לצבע, תמיד מאחר…"
          className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed")}
        />
      </label>

      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        ההערות נשמרות על הלקוח ולא על התור הזה — הן יופיעו בכל תור עתידי שלו
        ובכרטיס הלקוח.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={cn(btnPrimary, "h-11 flex-1 text-sm")}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          שמירת ההערות
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => onNotesChange(saved)}
            disabled={pending}
            className={cn(btnSecondary, "h-11 px-4 text-sm")}
          >
            ביטול
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Correcting what was typed: the name, the number, the booking's own note. */
function EditPanel({
  entry,
  appointmentId,
  onCancel,
  onSaved,
  onError,
}: {
  entry: CalendarEntry;
  appointmentId: string;
  onCancel: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    clientName: entry.title,
    clientPhone: entry.clientPhone ?? "",
    notes: entry.notes ?? "",
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await updateAppointmentDetailsAction({
        appointmentId,
        ...form,
      });
      if (result.ok) onSaved();
      else onError(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-3">
      <Field label="שם הלקוח" htmlFor="ap-name">
        <input
          id="ap-name"
          ref={firstFieldRef}
          value={form.clientName}
          onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label="טלפון" htmlFor="ap-phone">
        <input
          id="ap-phone"
          type="tel"
          dir="ltr"
          value={form.clientPhone}
          onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
          className={cn(inputClass, "text-start")}
        />
      </Field>

      <Field label="הערת הלקוח לתור הזה" htmlFor="ap-notes">
        <textarea
          id="ap-notes"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={cn(inputClass, "h-auto py-2 leading-relaxed")}
        />
      </Field>

      <PanelActions pending={pending} label="שמירת הפרטים" onCancel={onCancel} />
    </form>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Moving the appointment.
 *
 * The fields are date, time and — for a team — who takes it. Not the service:
 * that is what was sold, and changing it would change the price and the length
 * of the very thing being placed. The server re-derives the end from the
 * service's duration and re-runs availability, so nothing here is trusted
 * beyond the instant the owner picked.
 */
function MovePanel({
  entry,
  appointmentId,
  staff,
  timezone,
  onCancel,
  onSaved,
  onError,
}: {
  entry: CalendarEntry;
  appointmentId: string;
  staff: { id: string; name: string; color: string }[];
  timezone: string;
  onCancel: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    date: entry.date,
    time: entry.startTime,
    staffId: entry.staffId ?? "",
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const result = await rescheduleAppointmentAction({
        appointmentId,
        date: form.date,
        time: form.time,
        // A one-chair shop sends nothing and keeps whoever holds it.
        staffId: staff.length > 1 ? form.staffId : "",
      });
      if (result.ok) onSaved();
      else onError(result.error);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך" htmlFor="ap-date">
          <input
            id="ap-date"
            ref={firstFieldRef}
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="שעה" htmlFor="ap-time">
          <input
            id="ap-time"
            type="time"
            dir="ltr"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
            className={cn(inputClass, "tabular-nums")}
          />
        </Field>
      </div>

      {staff.length > 1 ? (
        <Field label="נותן שירות" htmlFor="ap-staff">
          <select
            id="ap-staff"
            value={form.staffId}
            onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            className={inputClass}
          >
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        המועד נבדק מול הזמינות ושעות הפעילות ({timezone}). הלקוח לא מקבל הודעה על
        השינוי — כדאי לעדכן אותו.
      </p>

      <PanelActions pending={pending} label="העברת התור" onCancel={onCancel} />
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function PanelActions({
  pending,
  label,
  onCancel,
}: {
  pending: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="submit"
        disabled={pending}
        className={cn(btnPrimary, "h-11 flex-1 text-sm")}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        {label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className={cn(btnSecondary, "h-11 px-4 text-sm")}
      >
        חזרה
      </button>
    </div>
  );
}

function Action({
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
  // The same four tones the agenda's quick actions use, for the same reason:
  // approving is the only thing being *asked* of the owner, so it is the only
  // filled control.
  const tones = {
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

/**
 * A sheet on a phone, a centred dialog on a desktop — the block dialog's shape,
 * including the bottom inset, because a sheet that ends under the home indicator
 * puts its primary button somewhere a thumb cannot reach.
 */
function Sheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-dialog-title"
        className="animate-sheet relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl sm:pb-5 dark:bg-zinc-900"
      >
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">
        {children}
      </dd>
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

function month(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCMonth() + 1;
}
