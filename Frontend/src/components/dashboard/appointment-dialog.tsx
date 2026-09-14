"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Clock,
  FileText,
  Loader2,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  RotateCcw,
  Scissors,
  Tag,
  TriangleAlert,
  UserRound,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  rescheduleAppointmentAction,
  setAppointmentStatusAction,
  updateAppointmentDetailsAction,
} from "@/app/dashboard/actions";
import { saveClientProfileAction } from "@/app/dashboard/clients/actions";
import { useToast } from "@/components/ui/toast";
import { dayOfMonth, formatPrice, weekdayLabel } from "@/lib/format";
import { staffSwatch } from "@/lib/staff-colors";
import { cn } from "@/lib/utils";
import { whatsappHref } from "@/lib/whatsapp-link";

import {
  btnPrimary,
  btnSecondary,
  focusRing,
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

  // One shared rule. The inline strip-and-swap this replaces mishandled a
  // `00972…` number — it saw the leading zero as a trunk code and produced
  // `9720972…`, a chat with nobody. See `whatsappHref`.
  const wa = whatsappHref(entry.clientPhone);

  function changeStatus(next: AppointmentStatusName) {
    const previous = status as AppointmentStatusName;
    setStatus(next); // optimistic
    setError(undefined);

    startTransition(async () => {
      const result = await setAppointmentStatusAction(appointmentId, next);
      if (result.ok) {
        // Only cancelling gets a way back — see `agenda-list`, which offers the
        // same undo on the same action for the same reason.
        toast(
          `${entry.title}: ${STATUS_LABEL[next]}`,
          next === "cancelled"
            ? { action: { label: "בטל פעולה", onAct: () => changeStatus(previous) } }
            : undefined,
        );
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

  /**
   * The two prominent actions work from either tab: they are about the
   * booking, and an owner reading the client's standing note is exactly when
   * "move this one" comes to mind. The form lives on the booking's tab, so that
   * is where they land.
   */
  function begin(next: "edit" | "move") {
    setError(undefined);
    setTab("appointment");
    setMode(next);
  }

  const phone = entry.clientPhone?.trim() ? entry.clientPhone : null;

  /**
   * Whose colour the glass carries — the card's own. A provider's hue on a
   * team, amber while a request waits, and otherwise nothing: the sheet falls
   * back to the shop's accent the way the card does. Read from live `status`,
   * so approving a request turns the glow from amber to the shop's colour
   * while the owner is still looking at it.
   */
  const hueClass = awaitingApproval
    ? "glass-hue-pending"
    : entry.staffColor
      ? staffSwatch(entry.staffColor).tint
      : undefined;

  return (
    <Sheet onClose={onClose} hueClass={hueClass}>
      {/* Where a thumb takes hold of a sheet. Decoration for the eye only —
          closing is the button, Escape, or the frosted page behind. */}
      <div
        aria-hidden
        className="mx-auto -mt-1 mb-4 h-1 w-10 rounded-full bg-zinc-950/15 sm:hidden dark:bg-white/20"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="appointment-dialog-title"
              className="truncate text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              {entry.title}
            </h2>
            <StatusChip status={status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            <span>{`יום ${weekdayLabel(entry.date)} ${dayOfMonth(entry.date)}/${month(entry.date)}`}</span>
            <span aria-hidden className="opacity-50">
              ·
            </span>
            <span
              className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100"
              dir="ltr"
            >
              {entry.startTime}–{entry.endTime}
            </span>
          </p>
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className={cn(
            "glass-control -me-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-600 dark:text-zinc-300",
            focusRing,
          )}
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/**
       * **The actions come before the details, because they are why the sheet
       * was opened.** An owner tapping a card mid-day is moving it, fixing it or
       * reaching the client — reading a price back to themselves is the rarest
       * reason. So the two things they change most are wide pills they cannot
       * miss, and the three ways to reach or release the client are bubbles
       * beneath them, the destructive one last and furthest from the thumb.
       *
       * A request has two answers of its own, and they go first: approving is
       * the one thing being *asked* of the owner, so it is the only solid fill
       * on the sheet. Hidden while a form is open, which has its own way back.
       */}
      {mode === "view" ? (
        <div className="mt-5 space-y-3">
          {awaitingApproval ? (
            <div className="grid grid-cols-2 gap-2">
              <Pill
                tone="approve"
                icon={Check}
                label="אישור התור"
                busy={pending}
                disabled={pending}
                onClick={() => changeStatus("confirmed")}
              />
              <Pill
                tone="danger"
                icon={X}
                label="דחייה"
                disabled={pending}
                onClick={() => changeStatus("cancelled")}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            {/* Moving a cancelled or finished appointment is not a thing to
                offer: the action refuses it server-side, and a button that
                always fails is worse than no button. Its place goes to the way
                back to an active booking instead. */}
            {open ? (
              <Pill
                tone="hue"
                icon={CalendarClock}
                label="העברה"
                disabled={pending}
                onClick={() => begin("move")}
              />
            ) : (
              <Pill
                tone="hue"
                icon={RotateCcw}
                label="החזרה לתור פעיל"
                busy={pending}
                disabled={pending}
                onClick={() => changeStatus("confirmed")}
              />
            )}
            <Pill
              tone="glass"
              icon={Pencil}
              label="עריכה"
              disabled={pending}
              onClick={() => begin("edit")}
            />
          </div>

          {phone || (open && !awaitingApproval) ? (
            <div className="flex items-start justify-center gap-5 pt-1">
              {phone ? (
                <Bubble icon={Phone} label="חיוג" href={`tel:${phone}`} />
              ) : null}
              {phone ? (
                /* WhatsApp where the number can reach it; a plain message
                   where it cannot, rather than a chat with nobody. */
                wa ? (
                  <Bubble
                    icon={MessageCircle}
                    label="וואטסאפ"
                    href={wa}
                    external
                  />
                ) : (
                  <Bubble
                    icon={MessageSquare}
                    label="הודעה"
                    href={`sms:${phone}`}
                  />
                )
              ) : null}
              {open && !awaitingApproval ? (
                <Bubble
                  tone="danger"
                  icon={X}
                  label="ביטול התור"
                  disabled={pending}
                  onClick={() => changeStatus("cancelled")}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The same segmented control the calendar's own view switch uses, set
          into the glass rather than floating on it. */}
      <div
        role="tablist"
        aria-label="פרטי התור והלקוח"
        className="glass-inset mt-5 mb-4 flex items-center gap-1 rounded-full p-1"
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
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-bold transition-colors",
              focusRing,
              tab === id
                ? "glass-control text-zinc-950 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50",
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
          {error ? (
            <p
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-2xl bg-red-50/90 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          {/* The facts as a line to glance along, not a form to read down: each
              one carries its own icon, and its name is there for a screen
              reader rather than repeated to everybody else. */}
          <ul className="flex flex-wrap gap-x-5 gap-y-2.5 text-sm text-zinc-800 dark:text-zinc-200">
            {entry.subtitle ? (
              <Fact icon={Scissors} label="שירות">
                {entry.subtitle}
              </Fact>
            ) : null}
            {entry.priceCents !== null ? (
              <Fact icon={Tag} label="מחיר">
                <span className="tabular-nums">
                  {formatPrice(entry.priceCents)}
                </span>
              </Fact>
            ) : null}
            {entry.staffName ? (
              <Fact icon={UserRound} label="נותן שירות">
                {entry.staffName}
              </Fact>
            ) : null}
            {phone ? (
              <Fact icon={Phone} label="טלפון">
                <span dir="ltr" className="tabular-nums">
                  {phone}
                </span>
              </Fact>
            ) : null}
          </ul>

          {/* This booking's note only. What the shop knows about the person
              lives on the other tab, because it is about the person. */}
          {entry.notes?.trim() ? (
            <div className="glass-inset mt-4 rounded-2xl px-3.5 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                <FileText className="size-3.5" aria-hidden />
                הערת הלקוח לתור הזה
              </p>
              <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {entry.notes}
              </p>
            </div>
          ) : null}

          {/* How it went — after the fact, so after the facts. Quiet on purpose:
              these close the record, they are not what the sheet is for. The
              same two marks the agenda's quick actions offer. */}
          {mode === "view" && open && !awaitingApproval ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <MarkChip
                icon={Check}
                label="הושלם"
                busy={pending}
                disabled={pending}
                onClick={() => changeStatus("completed")}
              />
              <MarkChip
                icon={UserX}
                label="לא הגיע"
                disabled={pending}
                onClick={() => changeStatus("no_show")}
              />
            </div>
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
  /**
   * **Reading is the default; writing is asked for.**
   *
   * This panel used to focus its textarea on mount, which on a phone means the
   * keyboard springs up and shoves the viewport the instant the tab is touched —
   * before the owner has read a word of the note they came to read. Most visits
   * here are to *look*: "what do we know about this person" is a question you
   * ask while the client is in front of you.
   *
   * So the note opens as text. The whole block is a button, and there is a
   * labelled one beside the heading, because "tap the text to edit" is a
   * convention worth offering but not worth relying on.
   */
  const [editing, setEditing] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Focus follows the *decision* to edit, never the arrival on the tab. The
  // caret goes to the end so an owner adding to an existing note is not typing
  // in front of it.
  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

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
        setEditing(false);
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
      <p className="glass-inset rounded-2xl px-3.5 py-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        לתור הזה אין מספר טלפון, והערות על לקוח נשמרות לפי מספר. אפשר להוסיף
        מספר דרך «עריכה» בלשונית «פרטי התור».
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

      <div className="mt-3 flex items-center justify-between gap-3">
        <span
          id="ap-client-notes-label"
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400"
        >
          <UserRound className="size-3.5" aria-hidden />
          הערות קבועות על הלקוח
        </span>

        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            <Pencil className="size-3" aria-hidden />
            {saved.trim() ? "עריכה" : "הוספת הערה"}
          </button>
        ) : null}
      </div>

      {editing ? (
        <textarea
          id="ap-client-notes"
          aria-labelledby="ap-client-notes-label"
          ref={fieldRef}
          rows={5}
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="מעדיף כיסא ליד החלון, רגיש לצבע, תמיד מאחר…"
          className={cn(inputClass, "mt-1.5 h-auto resize-y py-2 leading-relaxed")}
        />
      ) : (
        /* The read view is itself the way in, which is the convention on a
           phone — but it is a real button, so it is reachable by keyboard and
           announced as something you can do rather than as decoration. */
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-labelledby="ap-client-notes-label"
          className="mt-1.5 w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-start text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
        >
          {saved.trim() || (
            <span className="text-zinc-400">
              אין עדיין הערות על הלקוח. אפשר להוסיף כאן מה שכדאי לזכור.
            </span>
          )}
        </button>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
        ההערות נשמרות על הלקוח ולא על התור הזה — הן יופיעו בכל תור עתידי שלו
        ובכרטיס הלקוח.
      </p>

      {editing ? (
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
          <button
            type="button"
            onClick={() => {
              onNotesChange(saved); // discard the edit, keep what was stored
              setEditing(false);
            }}
            disabled={pending}
            className={cn(btnSecondary, "h-11 px-4 text-sm")}
          >
            ביטול
          </button>
        </div>
      ) : null}
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
  const panelRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    clientName: entry.title,
    clientPhone: entry.clientPhone ?? "",
    notes: entry.notes ?? "",
  });

  /**
   * **Focus the panel, not the first field.**
   *
   * Focusing the name input opened the on-screen keyboard the instant "עריכת
   * פרטים" was tapped, covering half the form the owner had just asked to see —
   * on the device this product is actually used on, mid-appointment.
   *
   * Dropping the focus call outright is the wrong fix: the control that was
   * focused has just been replaced by this panel, so focus would fall back to
   * `<body>` and a keyboard or screen-reader user would be dumped at the top of
   * the document with no idea the form had opened. Moving it to the form itself
   * — `tabIndex={-1}`, so it is focusable programmatically but not a tab stop —
   * keeps the announcement and the tab order without asking any device for text
   * input. Tapping a field is still what focuses a field.
   */
  useEffect(() => {
    panelRef.current?.focus();
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
    <form
      ref={panelRef}
      tabIndex={-1}
      onSubmit={submit}
      noValidate
      className="mt-4 space-y-3 focus:outline-none"
    >
      <Field label="שם הלקוח" htmlFor="ap-name">
        <input
          id="ap-name"
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
  const panelRef = useRef<HTMLFormElement>(null);
  /** The warning to show, or null. Set only by a refusal the owner can waive. */
  const [confirm, setConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: entry.date,
    time: entry.startTime,
    /**
     * Falls back to the first provider rather than to `""`, or the select would
     * *display* the first option while holding an empty value — the classic
     * uncontrolled-select mismatch, where submitting without touching the field
     * sends something other than what the owner is looking at.
     */
    staffId: entry.staffId ?? staff[0]?.id ?? "",
  });

  // The panel rather than the first field — see `EditPanel` for the whole
  // argument. It applies here at least as strongly: this form's first field is
  // a date input, which springs a picker rather than a keyboard.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    move(false);
  }

  /**
   * `force` waives the shop's *own* rules — posted hours, breaks, notice — and
   * nothing else. A same-provider clash comes back as a plain error, because
   * the database refuses it whatever this flag says, and asking "are you sure?"
   * before saying no anyway is worse than saying no.
   */
  function move(force: boolean) {
    startTransition(async () => {
      const result = await rescheduleAppointmentAction({
        appointmentId,
        date: form.date,
        time: form.time,
        /**
         * Always the chosen provider, where a one-chair shop used to send `""`
         * and let the server keep whoever held it. The two agree on a single
         * provider — it is the same person either way — and sending it
         * explicitly is what lets the field exist at all for such a shop. The
         * id is still resolved through the business server-side, so this is not
         * a new trust boundary.
         */
        staffId: form.staffId,
        force,
      });

      if (result.ok) {
        onSaved();
        return;
      }

      if ("confirm" in result) {
        setConfirm(result.message);
        return;
      }

      setConfirm(null);
      onError(result.error);
    });
  }

  return (
    <form
      ref={panelRef}
      tabIndex={-1}
      onSubmit={submit}
      noValidate
      className="mt-4 space-y-3 focus:outline-none"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="תאריך" htmlFor="ap-date">
          <input
            id="ap-date"
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

      {/**
       * Shown whenever there is anybody to assign, where this used to need a
       * team of two before it appeared at all.
       *
       * The threshold was hiding the field from the shop most likely to be
       * confused by its absence: an owner who has just added a second provider
       * sees the control appear out of nowhere on a dialog they already knew,
       * and one who has not cannot see who a booking belongs to without opening
       * the calendar legend. Who performs the service is a property of the
       * appointment at every roster size, so it is shown at every roster size —
       * with one provider it reads as a statement rather than a choice, and
       * becomes a choice the moment a second exists.
       */}
      {staff.length > 0 ? (
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

      {confirm ? (
        /**
         * Amber, not red: nothing has gone wrong. The move is possible and the
         * owner is being told which of their own rules it steps outside, with
         * the confirming button carrying the consequence in its label rather
         * than saying "OK".
         */
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
        >
          <p className="flex items-start gap-2 text-xs leading-relaxed font-medium text-amber-900 dark:text-amber-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {confirm}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => move(true)}
              disabled={pending}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              לשבץ בכל זאת
            </button>
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={pending}
              className="h-9 rounded-lg border border-amber-300 px-3 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              בחירת מועד אחר
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-zinc-500">
        המועד נבדק מול הזמינות ושעות הפעילות ({timezone}). הלקוח לא מקבל הודעה על
        השינוי — כדאי לעדכן אותו.
      </p>

      {confirm ? null : (
        <PanelActions pending={pending} label="העברת התור" onCancel={onCancel} />
      )}
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

/**
 * A wide action — the ones an owner reaches for most, sized so a thumb cannot
 * miss them. 48px tall, the height every primary control on the dashboard has.
 *
 * - `hue` carries the booking's colour as tinted glass under dark text; see
 *   `.glass-control-hue` for why it is never a fill under white.
 * - `approve` is the only solid fill: accepting a request is the one thing
 *   being asked of the owner. Emerald-700, not 600 — white on emerald-600 is
 *   3.7:1, which is under AA for this type, and the quick action this replaces
 *   had been shipping it.
 */
function Pill({
  tone,
  icon: Icon,
  label,
  onClick,
  disabled,
  busy,
}: {
  tone: "hue" | "glass" | "approve" | "danger";
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  const tones = {
    hue: "glass-control glass-control-hue text-zinc-950 dark:text-zinc-50",
    glass: "glass-control text-zinc-900 dark:text-zinc-100",
    approve:
      "bg-emerald-700 text-white shadow-sm transition-colors hover:bg-emerald-800 active:scale-[0.97] dark:bg-emerald-600 dark:text-emerald-950 dark:hover:bg-emerald-500",
    danger: "glass-control text-red-700 dark:text-red-300",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-60",
        focusRing,
        tones[tone],
      )}
    >
      {busy ? (
        <Loader2 className="size-[18px] shrink-0 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-[18px] shrink-0" aria-hidden />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * A round glass control with its name beneath it — reaching the client, or
 * letting the booking go.
 *
 * The whole column is the target, not just the circle: 56px of glass plus its
 * label is comfortably past the 44px a finger needs, and the label is real text,
 * so the control's accessible name is exactly what is on screen.
 */
function Bubble({
  icon: Icon,
  label,
  href,
  external,
  onClick,
  disabled,
  tone = "glass",
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "glass" | "danger";
}) {
  const body = (
    <>
      <span
        className={cn(
          "glass-control inline-flex size-14 items-center justify-center rounded-full group-active:scale-[0.96]",
          tone === "danger"
            ? "text-red-600 dark:text-red-400"
            : "text-zinc-800 dark:text-zinc-100",
        )}
      >
        <Icon className="size-[22px]" aria-hidden />
      </span>
      <span className="text-xs font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
    </>
  );

  const shell = cn(
    "group flex min-w-16 flex-col items-center gap-1.5 rounded-2xl p-1 disabled:opacity-60",
    focusRing,
  );

  return href ? (
    <a
      href={href}
      className={shell}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={shell}
    >
      {body}
    </button>
  );
}

/** One fact about the booking: an icon, a value, and its name for a screen reader. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      <Icon
        className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400"
        aria-hidden
      />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 truncate">{children}</span>
    </li>
  );
}

/** Closing the record: how the appointment went. Quieter than every action above. */
function MarkChip({
  icon: Icon,
  label,
  onClick,
  disabled,
  busy,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "glass-control inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-zinc-700 disabled:opacity-60 dark:text-zinc-300",
        focusRing,
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}

/**
 * A sheet on a phone, a centred dialog on a desktop — the block dialog's shape,
 * including the bottom inset, because a sheet that ends under the home indicator
 * puts its primary button somewhere a thumb cannot reach.
 *
 * Made of the calendar's glass: the page behind frosts rather than blacks out,
 * so the booking that was tapped stays faintly in view, and the edge glows in
 * that booking's colour (`hueClass`). `dvh` rather than `vh`, so a phone's
 * collapsing toolbar cannot push the sheet's last button off the screen.
 */
function Sheet({
  children,
  onClose,
  hueClass,
}: {
  children: React.ReactNode;
  onClose: () => void;
  hueClass?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="glass-scrim animate-frost absolute inset-0 cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-dialog-title"
        className={cn(
          "glass-sheet animate-glass-in relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:rounded-3xl sm:p-6",
          hueClass,
        )}
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
