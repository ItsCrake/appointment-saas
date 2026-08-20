"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  Check,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Search,
  UserPlus,
  X,
} from "lucide-react";

import {
  addWaitlistEntryAction,
  setWaitlistEntryStatusAction,
} from "@/app/dashboard/waitlist/actions";
import { useToast } from "@/components/ui/toast";
import { TIME_WINDOW_LABELS, WEEKDAY_NAMES } from "@/lib/waitlist";
import { cn } from "@/lib/utils";

import {
  btnPrimary,
  btnSecondary,
  cardClass,
  EmptyState,
  inputClass,
} from "./ui";

type Entry = {
  id: string;
  clientName: string;
  clientPhone: string;
  status: string;
  serviceName: string | null;
  staffName: string | null;
  /** "יום ראשון, יום רביעי · בוקר", resolved server-side. */
  preferences: string;
  notes: string | null;
  waitingSince: string;
  notifiedAt: string | null;
};

type Option = { id: string; name: string };
type TimeWindow = "morning" | "afternoon" | "evening" | "any";

const WINDOWS: TimeWindow[] = ["any", "morning", "afternoon", "evening"];

/**
 * The queue, and the three things an owner does with it: read it, reach
 * somebody, or take them off.
 *
 * ---------------------------------------------------------------------------
 * **Filtering is client-side over the whole list**, which is the right trade
 * here and not laziness: a waitlist is bounded by how many people one shop can
 * plausibly have waiting — tens, not thousands — and it is already loaded. A
 * search box that went to the server would make every keystroke a round trip
 * for rows sitting in the browser.
 *
 * Removing sets `cancelled` rather than deleting. The row is how the shop knows
 * this person asked, and an owner who removes the wrong one should be able to
 * see what happened rather than discover a silent gap.
 * ---------------------------------------------------------------------------
 */
export function WaitlistManager({
  entries,
  services,
  staff,
}: {
  entries: Entry[];
  services: Option[];
  staff: Option[];
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.clientName.toLowerCase().includes(needle) ||
        entry.clientPhone.includes(needle) ||
        (entry.serviceName ?? "").toLowerCase().includes(needle),
    );
  }, [entries, query]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">חיפוש ברשימה</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="שם, טלפון או שירות"
            className={cn(inputClass, "ps-9")}
          />
        </label>

        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(btnPrimary, "h-11 shrink-0 px-4 text-sm")}
        >
          <UserPlus className="size-4" aria-hidden />
          הוספה ידנית
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<BellRing className="size-5" />}
          title="אין אף אחד ברשימת ההמתנה"
          body="לקוחות שלא ימצאו תור פנוי בעמוד ההזמנות יוכלו להצטרף לרשימה, ואתם תוכלו להציע להם מועד שהתפנה."
          action={
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={cn(btnSecondary, "h-10 px-4 text-sm")}
            >
              <Plus className="size-4" aria-hidden />
              הוספת לקוח ידנית
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          אין תוצאות לחיפוש הזה.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {adding ? (
        <AddDialog
          services={services}
          staff={staff}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const phone = entry.clientPhone.replace(/\D/g, "");
  const wa = phone.startsWith("0") ? `972${phone.slice(1)}` : phone;

  function remove() {
    startTransition(async () => {
      const result = await setWaitlistEntryStatusAction(entry.id, "cancelled");
      if (result.ok) {
        toast(`${entry.clientName} הוסר מרשימת ההמתנה`);
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <li className={cn(cardClass, "p-4")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">
              {entry.clientName}
            </p>
            {/* "Offered and not yet answered" is a real state an owner acts on
                differently — it is why they are still here. */}
            {entry.status === "notified" ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200 ring-inset dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
                <BellRing className="size-3" aria-hidden />
                נשלחה הצעה
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 text-sm text-zinc-500">
            {entry.serviceName ?? "כל שירות"}
            {entry.staffName ? ` · ${entry.staffName}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">{entry.preferences}</p>

          {entry.notes ? (
            <p className="mt-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {entry.notes}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="הסרה מהרשימה"
          className="-me-1 shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-red-950/40"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <X className="size-4" aria-hidden />
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`tel:${entry.clientPhone}`}
          className={cn(btnSecondary, "h-9 px-3 text-xs")}
        >
          <Phone className="size-3.5" aria-hidden />
          <span dir="ltr">{entry.clientPhone}</span>
        </a>
        <a
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(btnSecondary, "h-9 px-3 text-xs")}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          וואטסאפ
        </a>
      </div>
    </li>
  );
}

/** The owner adding somebody who rang up — the one path that can name a provider. */
function AddDialog({
  services,
  staff,
  onClose,
}: {
  services: Option[];
  staff: Option[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [days, setDays] = useState<number[]>([]);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("any");
  const [form, setForm] = useState({
    clientName: "",
    clientPhone: "",
    serviceId: "",
    preferredStaffId: "",
    notes: "",
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    startTransition(async () => {
      const result = await addWaitlistEntryAction({
        ...form,
        preferredDays: days,
        preferredTimeWindow: timeWindow,
      });

      if (result.ok) {
        toast(result.message ?? "נוסף לרשימה");
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-black/40"
      />

      <form
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="waitlist-add-title"
        className="animate-sheet relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl sm:pb-5 dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="waitlist-add-title"
            className="text-base font-bold text-zinc-900 dark:text-zinc-100"
          >
            הוספה לרשימת ההמתנה
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="-me-1 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="שם הלקוח" htmlFor="wa-name">
            <input
              id="wa-name"
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="טלפון" htmlFor="wa-phone">
            <input
              id="wa-phone"
              type="tel"
              dir="ltr"
              value={form.clientPhone}
              onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
              className={cn(inputClass, "text-start")}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="שירות" htmlFor="wa-service">
              <select
                id="wa-service"
                value={form.serviceId}
                onChange={(e) =>
                  setForm({ ...form, serviceId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">כל שירות</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="נותן שירות" htmlFor="wa-staff">
              <select
                id="wa-staff"
                value={form.preferredStaffId}
                onChange={(e) =>
                  setForm({ ...form, preferredStaffId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">כל אחד</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              ימים מועדפים
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_NAMES.map((name, day) => {
                const on = days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDays((current) =>
                        current.includes(day)
                          ? current.filter((value) => value !== day)
                          : [...current, day],
                      )
                    }
                    className={cn(
                      "h-9 min-w-11 rounded-xl px-2.5 text-xs font-semibold transition-colors",
                      on
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              שעות מועדפות
            </legend>
            <div className="grid grid-cols-4 gap-1.5">
              {WINDOWS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={timeWindow === value}
                  onClick={() => setTimeWindow(value)}
                  className={cn(
                    "h-9 rounded-xl px-2 text-xs font-semibold transition-colors",
                    timeWindow === value
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300",
                  )}
                >
                  {TIME_WINDOW_LABELS[value]}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label="הערה (לא חובה)" htmlFor="wa-notes">
            <input
              id="wa-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputClass}
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={pending}
          className={cn(btnPrimary, "mt-4 h-11 w-full")}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          הוספה לרשימה
        </button>
      </form>
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
