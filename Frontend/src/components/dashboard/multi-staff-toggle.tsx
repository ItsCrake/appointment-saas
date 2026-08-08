"use client";

import { useState, useTransition } from "react";
import { Users } from "lucide-react";

import { setMultiStaffAction } from "@/app/dashboard/staff/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { cardClass } from "./ui";

/**
 * The one binary question, asked here and during setup.
 *
 * Turning it **off is not destructive**: every staff row survives, so turning
 * it back on restores the team exactly as it was. That is what makes it safe to
 * present as a yes/no rather than as a migration — an owner experimenting with
 * it cannot lose anything.
 *
 * What it changes is what everyone *sees*: off, the client never meets a staff
 * picker and the sole provider takes every booking silently.
 */
export function MultiStaffToggle({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [value, setValue] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function set(next: boolean) {
    // Optimistic, and reverted on failure: the switch is the control being
    // operated, so leaving it stale while the request flies reads as broken.
    setValue(next);
    startTransition(async () => {
      const result = await setMultiStaffAction(next);
      if (result.ok) toast(result.message ?? "נשמר", "success");
      else {
        setValue(!next);
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className={cn(cardClass, "p-4")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        >
          <Users className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            האם יש יותר מנותן שירות אחד בעסק?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {value
              ? "לקוחות יוכלו לבחור עם מי לקבוע, או לבחור במי שפנוי ראשון."
              : "כרגע כל התורים משויכים אליכם, ולקוחות לא רואים בחירת נותן שירות."}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="ניהול צוות"
          disabled={pending}
          onClick={() => set(!value)}
          className={cn(
            "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-900",
            value
              ? "bg-[image:var(--brand-gradient)]"
              : "bg-zinc-300 dark:bg-zinc-700",
          )}
        >
          {/* `end-0.5` rather than `right-0.5`: the page is RTL, and a knob
              pinned to a physical edge slides the wrong way. */}
          <span
            aria-hidden
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
              value ? "end-0.5" : "start-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}
