"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CalendarCheck, CalendarX2, UserX, X } from "lucide-react";

import { saveClientProfileAction } from "@/app/dashboard/clients/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { btnPrimary, btnSecondary, inputClass, StatusChip } from "./ui";

export type ClientHistoryRow = {
  id: string;
  /** Pre-formatted on the server, in the business timezone. */
  when: string;
  status: string;
  serviceName: string;
  price: string;
  notes: string | null;
};

export type ClientProfileData = {
  clientPhone: string;
  clientName: string;
  notes: string;
  stats: {
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    upcoming: number;
  };
  history: ClientHistoryRow[];
};

/**
 * One client, everything known about them.
 *
 * A drawer rather than a route, because it is a detail *of* the list: an owner
 * opens three in a row while scanning, and a page per client would make that
 * three navigations and three back-buttons. It also keeps the search query the
 * list is filtered by, which a navigation would discard.
 */
export function ClientProfileDrawer({
  profile,
  onClose,
}: {
  profile: ClientProfileData;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  const [notes, setNotes] = useState(profile.notes);
  const dirty = notes.trim() !== profile.notes.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  function save() {
    startTransition(async () => {
      const result = await saveClientProfileAction({
        clientPhone: profile.clientPhone,
        notes,
      });

      if (result.ok) {
        toast(result.message ?? "ההערות נשמרו", "success");
        onClose();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-start">
      <button
        type="button"
        aria-label="סגירה"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade absolute inset-0 cursor-default bg-black/40"
      />

      {/* Anchored to the inline-start edge, which in RTL is the right — the
          side the list it came from lives on. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-sheet relative ms-auto flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-lg font-bold text-zinc-900 dark:text-zinc-50"
            >
              {profile.clientName}
            </h2>
            <p
              dir="ltr"
              className="mt-0.5 text-start text-sm text-zinc-500 tabular-nums"
            >
              {profile.clientPhone}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="-me-2 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {/* Three numbers, and the two that are not "came in" are the ones an
              owner is actually looking for. A regular with six visits and no
              cancellations reads differently from one with six visits and four
              — and the second is who you check before holding a slot. */}
          <dl className="grid grid-cols-3 gap-2">
            <Stat
              icon={<CalendarCheck className="size-4" aria-hidden />}
              label="ביקורים"
              value={profile.stats.completed}
              tone="good"
            />
            <Stat
              icon={<CalendarX2 className="size-4" aria-hidden />}
              label="ביטולים"
              value={profile.stats.cancelled}
              tone={profile.stats.cancelled > 0 ? "warn" : "quiet"}
            />
            <Stat
              icon={<UserX className="size-4" aria-hidden />}
              label="לא הגיע"
              value={profile.stats.noShow}
              tone={profile.stats.noShow > 0 ? "bad" : "quiet"}
            />
          </dl>

          <section>
            <label
              htmlFor="client-notes"
              className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            >
              העדפות והערות
            </label>
            <p className="mt-0.5 mb-2 text-xs text-zinc-500">
              נשמר ללקוח לפי מספר הטלפון ומופיע בכל תור שלו ביומן. הלקוח לא רואה
              את זה.
            </p>
            <textarea
              id="client-notes"
              rows={4}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="מעדיף כיסא ליד החלון, רגיש לצבע, תמיד מאחר…"
              className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed")}
            />

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending || !dirty}
                className={cn(btnPrimary, "h-10 px-4 text-sm")}
              >
                {pending ? "שומר…" : "שמירה"}
              </button>
              {dirty ? (
                <button
                  type="button"
                  onClick={() => setNotes(profile.notes)}
                  className={cn(btnSecondary, "h-10 px-4 text-sm")}
                >
                  ביטול
                </button>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              היסטוריית תורים
              <span className="ms-1.5 text-xs font-normal text-zinc-500 tabular-nums">
                ({profile.stats.total})
              </span>
            </h3>

            {profile.history.length === 0 ? (
              <p className="text-sm text-zinc-500">אין עדיין תורים.</p>
            ) : (
              <ul className="space-y-2">
                {profile.history.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-900 tabular-nums dark:text-zinc-100">
                        {row.when}
                      </span>
                      <StatusChip status={row.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {row.serviceName} · {row.price}
                    </p>
                    {row.notes ? (
                      <p className="mt-1.5 rounded-lg bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {row.notes}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "quiet";
}) {
  const tones = {
    good: "text-emerald-700 dark:text-emerald-300",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-rose-700 dark:text-rose-300",
    // Zero is the good answer for cancellations and no-shows, so it stays grey
    // rather than borrowing a colour that would read as a warning.
    quiet: "text-zinc-400",
  } as const;

  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2.5 text-center dark:border-zinc-800">
      <dt className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
        {icon}
        {label}
      </dt>
      <dd className={cn("mt-0.5 text-xl font-bold tabular-nums", tones[tone])}>
        {value}
      </dd>
    </div>
  );
}
