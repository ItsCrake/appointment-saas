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

/**
 * Numeric fields are edited as **strings**, not numbers.
 *
 * A number-backed input cannot hold "empty": clearing it yields `Number("")`,
 * which is `0`, so the field springs back to a zero the owner then has to
 * select and delete before every entry. Keeping the raw text lets the field be
 * genuinely blank while it is being typed into, and it is parsed once on
 * submit. `selectOnFocus` below covers the other half — landing in a field
 * that already reads "30" and typing replaces it instead of making "300".
 */
type DraftRow = {
  name: string;
  /** Minutes, as typed. */
  duration: string;
  /** Shekels, as typed. Converted to agorot on submit. */
  price: string;
};

/** Editable starting point — nobody should face an empty form here. */
const TEMPLATES: DraftRow[] = [
  { name: "תספורת גבר", duration: "30", price: "70" },
  { name: "תספורת ילד", duration: "20", price: "60" },
  { name: "עיצוב זקן", duration: "15", price: "30" },
];

/** Selects the whole value so the first keystroke replaces it. */
function selectOnFocus(event: React.FocusEvent<HTMLInputElement>) {
  event.target.select();
}

const FIELD =
  "h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 focus:border-transparent focus:ring-2 focus:ring-zinc-950 dark:focus:ring-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

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
  const [drafts, setDrafts] = useState<DraftRow[]>(
    existing.length > 0
      ? existing.map((s) => ({
          name: s.name,
          duration: String(s.durationMin),
          price: String(s.priceCents / 100),
        }))
      : TEMPLATES,
  );

  function update(index: number, patch: Partial<DraftRow>) {
    setDrafts((prev) =>
      prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  function remove(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    setDrafts((prev) => [...prev, { name: "", duration: "30", price: "50" }]);
  }

  /** Parsed once, here. A blank field is 0 at this point and nowhere earlier. */
  function toServices(): DraftService[] {
    return drafts.map((draft) => ({
      name: draft.name,
      durationMin: Number(draft.duration) || 0,
      priceCents: Math.round((Number(draft.price) || 0) * 100),
    }));
  }

  const alreadySaved = new Set(existing.map((s) => s.name.trim()));

  return (
    <div>
      <p className="mb-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        התחלנו עם שלוש הצעות נפוצות. ערכו, מחקו או הוסיפו — אפשר לשנות מתי
        שתרצו.
      </p>

      <ul className="space-y-3">
        {drafts.map((draft, index) => (
          <li
            key={index}
            className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
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
                className="shrink-0 rounded-lg border border-zinc-200 p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:border-zinc-700"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-zinc-500">
                  דקות
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={600}
                  value={draft.duration}
                  onFocus={selectOnFocus}
                  onChange={(e) => update(index, { duration: e.target.value })}
                  className={`${FIELD} tabular-nums`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-zinc-500">
                  מחיר ₪
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={draft.price}
                  onFocus={selectOnFocus}
                  onChange={(e) => update(index, { price: e.target.value })}
                  className={`${FIELD} tabular-nums`}
                />
              </label>
            </div>

            <p
              className={cn(
                "mt-2 flex items-center gap-1.5 text-[11px]",
                alreadySaved.has(draft.name.trim())
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-400",
              )}
            >
              {alreadySaved.has(draft.name.trim()) ? (
                <>
                  <Check className="size-3" aria-hidden />
                  נשמר כבר
                </>
              ) : (
                <>
                  {formatDuration(Number(draft.duration) || 0)} ·{" "}
                  {formatPrice(Math.round((Number(draft.price) || 0) * 100))}
                </>
              )}
            </p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={add}
        className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Plus className="size-4" aria-hidden />
        שירות נוסף
      </button>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() =>
            onSubmit(toServices().filter((service) => service.name.trim()))
          }
          disabled={pending}
          className="h-12 flex-1 rounded-xl bg-zinc-900 text-sm font-semibold text-white disabled:opacity-60"
        >
          המשך לשעות
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="h-12 rounded-xl border border-zinc-300 px-5 text-sm font-semibold text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
        >
          חזרה
        </button>
      </div>
    </div>
  );
}
