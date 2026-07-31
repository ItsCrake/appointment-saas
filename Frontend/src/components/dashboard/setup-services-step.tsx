"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";

import { formatDuration, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type DraftService = {
  name: string;
  durationMin: number;
  priceCents: number;
};

/** Editable starting point — nobody should face an empty form here. */
const TEMPLATES: DraftService[] = [
  { name: "תספורת גבר", durationMin: 30, priceCents: 7000 },
  { name: "תספורת ילד", durationMin: 20, priceCents: 6000 },
  { name: "עיצוב זקן", durationMin: 15, priceCents: 3000 },
];

const FIELD =
  "h-10 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-sm text-neutral-900 focus:border-transparent focus:ring-2 focus:ring-neutral-900 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

export function SetupServicesStep({
  existing,
  pending,
  onBack,
  onSubmit,
}: {
  existing: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
  }[];
  pending: boolean;
  onBack: () => void;
  onSubmit: (services: DraftService[]) => void;
}) {
  // Returning to this step shows what was already saved, not the templates.
  const [drafts, setDrafts] = useState<DraftService[]>(
    existing.length > 0
      ? existing.map((s) => ({
          name: s.name,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
        }))
      : TEMPLATES,
  );

  function update(index: number, patch: Partial<DraftService>) {
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  function remove(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    setDrafts((prev) => [
      ...prev,
      { name: "", durationMin: 30, priceCents: 5000 },
    ]);
  }

  const alreadySaved = new Set(existing.map((s) => s.name.trim()));

  return (
    <div>
      <p className="mb-4 rounded-xl bg-neutral-50 px-4 py-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
        התחלנו עם שלוש הצעות נפוצות. ערכו, מחקו או הוסיפו — אפשר לשנות מתי
        שתרצו.
      </p>

      <ul className="space-y-3">
        {drafts.map((draft, index) => (
          <li
            key={index}
            className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                value={draft.name}
                onChange={(e) => update(index, { name: e.target.value })}
                placeholder="שם השירות"
                className={FIELD}
              />
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label="הסרת שירות"
                className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-neutral-700"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-neutral-500">
                  דקות
                </span>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={draft.durationMin}
                  onChange={(e) =>
                    update(index, { durationMin: Number(e.target.value) })
                  }
                  className={`${FIELD} tabular-nums`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-neutral-500">
                  מחיר ₪
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.priceCents / 100}
                  onChange={(e) =>
                    update(index, {
                      priceCents: Math.round(Number(e.target.value) * 100),
                    })
                  }
                  className={`${FIELD} tabular-nums`}
                />
              </label>
            </div>

            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 text-[11px]",
                alreadySaved.has(draft.name.trim())
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-neutral-400",
              )}
            >
              {alreadySaved.has(draft.name.trim()) ? (
                <>
                  <Check className="size-3" aria-hidden />
                  נשמר כבר
                </>
              ) : (
                <>
                  {formatDuration(draft.durationMin)} ·{" "}
                  {formatPrice(draft.priceCents)}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={add}
        className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Plus className="size-4" aria-hidden />
        שירות נוסף
      </button>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(drafts.filter((d) => d.name.trim()))}
          disabled={pending}
          className="h-12 flex-1 rounded-xl bg-neutral-900 text-sm font-semibold text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          המשך לשעות
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-12 rounded-xl border border-neutral-300 px-5 text-sm font-semibold text-neutral-700 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
        >
          חזרה
        </button>
      </div>
    </div>
  );
}
