"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { setLibiAddressGenderAction } from "@/app/dashboard/settings/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { AddressGender } from "@/lib/voice/libi-address";

/**
 * How ליבי should address the person she is talking to.
 *
 * ---------------------------------------------------------------------------
 * **Hebrew has no neutral second person, which is why this is a setting and not
 * a preference.** "Would you like me to update it" is either תרצה or תרצי;
 * there is no third form to fall back on. Whichever the product picks unasked
 * is wrong for about half the shops it runs in — every turn, spoken aloud, in
 * front of whoever is in the chair.
 *
 * **Saved on click, not on a Save button.** Two options with an immediate
 * audible consequence is the same shape as the push toggle next to it: an owner
 * who has chosen how they want to be spoken to has already made the decision,
 * and putting it behind the page's save bar would leave it wrong for anyone who
 * forgets. The previous value is restored if the write fails, so the control
 * never shows a state the server does not have.
 * ---------------------------------------------------------------------------
 */
export function LibiSettings({ initial }: { initial: AddressGender }) {
  const { toast } = useToast();
  const [gender, setGender] = useState<AddressGender>(initial);
  const [saving, startSave] = useTransition();

  function choose(next: AddressGender) {
    if (next === gender || saving) return;

    const previous = gender;
    // Moved first so the control answers the click; put back if the write does
    // not land, rather than showing a choice the server did not take.
    setGender(next);

    startSave(async () => {
      const outcome = await setLibiAddressGenderAction(next);
      if (outcome.ok) {
        toast(
          next === "female"
            ? "ליבי תפנה אלייך בלשון נקבה"
            : "ליבי תפנה אליך בלשון זכר",
        );
      } else {
        setGender(previous);
        toast(outcome.error, "error");
      }
    });
  }

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      role="radiogroup"
      aria-label="לשון הפנייה של ליבי"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            לשון הפנייה
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            בעברית אין פנייה ניטרלית — ליבי אומרת &quot;תרצה&quot; או
            &quot;תרצי&quot;.
          </p>
        </div>
        {saving ? (
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin text-zinc-400"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        {(
          [
            { value: "male", label: "זכר", example: "תרצה שאעדכן?" },
            { value: "female", label: "נקבה", example: "תרצי שאעדכן?" },
          ] as const
        ).map((option) => {
          const active = gender === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={saving}
              onClick={() => choose(option.value)}
              className={cn(
                "flex-1 rounded-lg border px-3 py-2 text-start transition-colors disabled:opacity-60",
                active
                  ? "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-zinc-50">
                {active ? (
                  <Check
                    className="size-3.5 text-violet-600 dark:text-violet-400"
                    aria-hidden
                  />
                ) : null}
                {option.label}
              </span>
              {/* The example is the control. "זכר" is a label; "תרצה שאעדכן?"
                  is what the owner will actually hear, and it is the thing
                  they are choosing between. */}
              <span className="mt-0.5 block text-xs text-zinc-500">
                &quot;{option.example}&quot;
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
