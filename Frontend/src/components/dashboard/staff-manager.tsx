"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Plus, Trash2, UserRound, X } from "lucide-react";

import {
  createStaffAction,
  createStaffTimeOffAction,
  deleteStaffTimeOffAction,
  saveStaffScheduleAction,
  setStaffActiveAction,
  updateStaffAction,
  type StaffActionResult,
} from "@/app/dashboard/staff/actions";
import { useToast } from "@/components/ui/toast";
import { STAFF_COLORS, staffSwatch, type StaffColor } from "@/lib/staff-colors";
import { cn } from "@/lib/utils";

import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  cardClass,
  EmptyState,
  inputClass,
} from "./ui";

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type StaffRow = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  color: string;
  isActive: boolean;
  /** Empty means "works the business hours". */
  shifts: { weekday: number; startTime: string; endTime: string }[];
};

export type StaffTimeOffRow = {
  id: string;
  staffId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  /** Pre-formatted in the business timezone — the server owns that conversion. */
  label: string;
};

type Draft = {
  name: string;
  title: string;
  phone: string;
  color: StaffColor;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  title: "",
  phone: "",
  color: "slate",
};

export function StaffManager({
  staff,
  timeOff,
  today,
}: {
  staff: StaffRow[];
  timeOff: StaffTimeOffRow[];
  /** "YYYY-MM-DD" in the business timezone, for the time-off date default. */
  today: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string>();
  const [schedulingId, setSchedulingId] = useState<string>();

  function run(action: () => Promise<StaffActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast(result.message ?? "נשמר", "success");
        onDone?.();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            נותני שירות
          </h2>
          {!adding ? (
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setAdding(true);
              }}
              className={cn(btnSecondary, "h-9 px-4 text-xs")}
            >
              <Plus className="size-4" aria-hidden />
              הוספה
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className={cn(cardClass, "mb-3 p-4")}>
            <StaffFields draft={draft} onChange={setDraft} />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => createStaffAction(draft),
                    () => {
                      setAdding(false);
                      setDraft(EMPTY_DRAFT);
                    },
                  )
                }
                className={cn(btnPrimary, "h-10 flex-1 text-xs")}
              >
                שמירה
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className={cn(btnSecondary, "h-10 px-4 text-xs")}
              >
                ביטול
              </button>
            </div>
          </div>
        ) : null}

        {staff.length === 0 ? (
          <EmptyState
            icon={<UserRound className="size-5" />}
            title="אין עדיין נותני שירות"
            body="הוסיפו את מי שנותן את השירות בעסק כדי שלקוחות יוכלו לבחור."
          />
        ) : (
          <ul className="space-y-3">
            {staff.map((member) => (
              <li key={member.id} className={cn(cardClass, "p-4")}>
                <StaffCard
                  member={member}
                  editing={editingId === member.id}
                  scheduling={schedulingId === member.id}
                  pending={pending}
                  onEdit={() => {
                    setEditingId(member.id);
                    setSchedulingId(undefined);
                  }}
                  onCancelEdit={() => setEditingId(undefined)}
                  onToggleSchedule={() =>
                    setSchedulingId((id) =>
                      id === member.id ? undefined : member.id,
                    )
                  }
                  onSave={(next) =>
                    run(
                      () => updateStaffAction(member.id, next),
                      () => setEditingId(undefined),
                    )
                  }
                  onSetActive={(active) =>
                    run(() => setStaffActiveAction(member.id, active))
                  }
                  onSaveSchedule={(shifts) =>
                    run(
                      () => saveStaffScheduleAction(member.id, shifts),
                      () => setSchedulingId(undefined),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <TimeOffSection
        staff={staff}
        timeOff={timeOff}
        today={today}
        pending={pending}
        onCreate={(input, done) =>
          run(() => createStaffTimeOffAction(input), done)
        }
        onDelete={(id) => run(() => deleteStaffTimeOffAction(id))}
      />
    </div>
  );
}

function StaffFields({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            שם
          </span>
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            className={inputClass}
            placeholder="יוסי"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            תפקיד (לא חובה)
          </span>
          <input
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            className={inputClass}
            placeholder="ספר בכיר"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          טלפון (לא חובה)
        </span>
        <input
          value={draft.phone}
          onChange={(e) => onChange({ ...draft, phone: e.target.value })}
          className={inputClass}
          dir="ltr"
          inputMode="tel"
          placeholder="050-0000000"
        />
        <span className="mt-1 block text-[11px] text-zinc-500">
          לשימושכם בלבד — לא נשלחות אליו הודעות.
        </span>
      </label>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          צבע ביומן
        </legend>
        <div className="flex flex-wrap gap-2">
          {STAFF_COLORS.map((color) => {
            const swatch = staffSwatch(color);
            const selected = draft.color === color;
            return (
              <button
                key={color}
                type="button"
                onClick={() => onChange({ ...draft, color })}
                aria-pressed={selected}
                aria-label={swatch.label}
                title={swatch.label}
                className={cn(
                  "size-8 rounded-full ring-offset-2 transition-transform focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:ring-offset-zinc-900 dark:focus-visible:ring-white",
                  swatch.dot,
                  selected
                    ? "scale-110 ring-2 ring-zinc-950 dark:ring-white"
                    : "hover:scale-105",
                )}
              />
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function StaffCard({
  member,
  editing,
  scheduling,
  pending,
  onEdit,
  onCancelEdit,
  onToggleSchedule,
  onSave,
  onSetActive,
  onSaveSchedule,
}: {
  member: StaffRow;
  editing: boolean;
  scheduling: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onToggleSchedule: () => void;
  onSave: (draft: Draft) => void;
  onSetActive: (active: boolean) => void;
  onSaveSchedule: (
    shifts: { weekday: number; startTime: string; endTime: string }[],
  ) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: member.name,
    title: member.title ?? "",
    phone: member.phone ?? "",
    color: (member.color as StaffColor) ?? "slate",
  });

  const swatch = staffSwatch(member.color);

  if (editing) {
    return (
      <div>
        <StaffFields draft={draft} onChange={setDraft} />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave(draft)}
            className={cn(btnPrimary, "h-10 flex-1 text-xs")}
          >
            שמירה
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            className={cn(btnSecondary, "h-10 px-4 text-xs")}
          >
            ביטול
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-1 size-3 shrink-0 rounded-full", swatch.dot)}
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              member.isActive
                ? "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-400 line-through",
            )}
          >
            {member.name}
          </p>
          {member.title ? (
            <p className="truncate text-xs text-zinc-500">{member.title}</p>
          ) : null}
          {member.phone ? (
            <p dir="ltr" className="truncate text-start text-xs text-zinc-500">
              {member.phone}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-zinc-500">
            {member.shifts.length === 0
              ? "עובד לפי שעות העסק"
              : `${member.shifts.length} משמרות בשבוע`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEdit}
          className={cn(btnSecondary, "h-9 px-3 text-xs")}
        >
          עריכה
        </button>
        <button
          type="button"
          onClick={onToggleSchedule}
          className={cn(btnSecondary, "h-9 px-3 text-xs")}
        >
          שעות עבודה
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSetActive(!member.isActive)}
          className={cn(
            member.isActive ? btnDanger : btnSecondary,
            "h-9 px-3 text-xs",
          )}
        >
          {member.isActive ? "השבתה" : "הפעלה"}
        </button>
      </div>

      {scheduling ? (
        <ScheduleEditor
          shifts={member.shifts}
          pending={pending}
          onSave={onSaveSchedule}
        />
      ) : null}
    </div>
  );
}

/**
 * One row per weekday, each either "as the business" or a single shift.
 *
 * Deliberately simpler than the business hours editor, which supports split
 * shifts: a per-person override exists to say "Yossi works mornings", and
 * offering a second shift per day here would mostly produce empty fields. An
 * empty grid means the person follows the shop, which is the common case and
 * the default.
 */
function ScheduleEditor({
  shifts,
  pending,
  onSave,
}: {
  shifts: { weekday: number; startTime: string; endTime: string }[];
  pending: boolean;
  onSave: (
    next: { weekday: number; startTime: string; endTime: string }[],
  ) => void;
}) {
  const [rows, setRows] = useState(() =>
    WEEKDAYS.map((_, weekday) => {
      const found = shifts.find((s) => s.weekday === weekday);
      return {
        weekday,
        enabled: Boolean(found),
        startTime: found?.startTime.slice(0, 5) ?? "09:00",
        endTime: found?.endTime.slice(0, 5) ?? "17:00",
      };
    }),
  );

  const anyEnabled = rows.some((row) => row.enabled);

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        אם לא תסמנו אף יום, נותן השירות עובד לפי שעות הפעילות של העסק.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.weekday} className="flex items-center gap-2">
            <label className="flex w-24 shrink-0 items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) =>
                  setRows((current) =>
                    current.map((r) =>
                      r.weekday === row.weekday
                        ? { ...r, enabled: e.target.checked }
                        : r,
                    ),
                  )
                }
                className="size-4 accent-zinc-900 dark:accent-zinc-100"
              />
              {WEEKDAYS[row.weekday]}
            </label>

            {/* dir=ltr keeps the Android time picker on screen in an RTL page. */}
            <input
              type="time"
              dir="ltr"
              disabled={!row.enabled}
              value={row.startTime}
              onChange={(e) =>
                setRows((current) =>
                  current.map((r) =>
                    r.weekday === row.weekday
                      ? { ...r, startTime: e.target.value }
                      : r,
                  ),
                )
              }
              className={cn(
                inputClass,
                "h-9 flex-1 text-xs disabled:opacity-40",
              )}
            />
            <input
              type="time"
              dir="ltr"
              disabled={!row.enabled}
              value={row.endTime}
              onChange={(e) =>
                setRows((current) =>
                  current.map((r) =>
                    r.weekday === row.weekday
                      ? { ...r, endTime: e.target.value }
                      : r,
                  ),
                )
              }
              className={cn(
                inputClass,
                "h-9 flex-1 text-xs disabled:opacity-40",
              )}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onSave(
            rows
              .filter((row) => row.enabled)
              .map(({ weekday, startTime, endTime }) => ({
                weekday,
                startTime,
                endTime,
              })),
          )
        }
        className={cn(btnPrimary, "mt-4 h-10 w-full text-xs")}
      >
        {anyEnabled ? "שמירת השעות" : "שמירה — לפי שעות העסק"}
      </button>
    </div>
  );
}

function TimeOffSection({
  staff,
  timeOff,
  today,
  pending,
  onCreate,
  onDelete,
}: {
  staff: StaffRow[];
  timeOff: StaffTimeOffRow[];
  today: string;
  pending: boolean;
  onCreate: (input: unknown, done: () => void) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    staffId: "",
    date: today,
    startTime: "09:00",
    endTime: "12:00",
    reason: "",
  });

  const nameFor = (id: string | null) =>
    id ? (staff.find((s) => s.id === id)?.name ?? "—") : "כל העסק";

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          חסימות וחופשות
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(btnSecondary, "h-9 px-4 text-xs")}
        >
          {open ? (
            <X className="size-4" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
          {open ? "סגירה" : "הוספה"}
        </button>
      </div>

      {open ? (
        <div className={cn(cardClass, "mb-3 space-y-3 p-4")}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              על מי חל
            </span>
            <select
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
              className={inputClass}
            >
              {/* The default is the whole shop, which is the original meaning of
                  a time-off row and still the more common one. */}
              <option value="">כל העסק (סגירה כללית)</option>
              {staff
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                תאריך
              </span>
              <input
                type="date"
                dir="ltr"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={cn(inputClass, "text-xs")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                משעה
              </span>
              <input
                type="time"
                dir="ltr"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value })
                }
                className={cn(inputClass, "text-xs")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                עד שעה
              </span>
              <input
                type="time"
                dir="ltr"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className={cn(inputClass, "text-xs")}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              סיבה (לא חובה)
            </span>
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className={inputClass}
              placeholder="חופשה"
            />
          </label>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              onCreate(form, () => {
                setOpen(false);
                setForm({ ...form, reason: "" });
              })
            }
            className={cn(btnPrimary, "h-10 w-full text-xs")}
          >
            שמירת החסימה
          </button>
        </div>
      ) : null}

      {timeOff.length === 0 ? (
        <EmptyState
          icon={<CalendarOff className="size-5" />}
          title="אין חסימות קרובות"
          body="חסימה מונעת קביעת תורים בטווח שנבחר — לעסק כולו או לנותן שירות אחד."
        />
      ) : (
        <ul
          className={cn(
            cardClass,
            "divide-y divide-zinc-200 dark:divide-zinc-800",
          )}
        >
          {timeOff.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {nameFor(row.staffId)}
                </span>
                <span className="block text-xs break-words text-zinc-500">
                  {row.label}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => onDelete(row.id)}
                aria-label="הסרת החסימה"
                className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:text-red-600"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
