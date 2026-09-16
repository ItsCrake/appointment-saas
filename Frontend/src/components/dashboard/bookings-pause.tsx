"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePause, Loader2 } from "lucide-react";

import { setBookingsPausedAction } from "@/app/dashboard/settings/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { focusRing } from "./ui";

/**
 * Pause and resume online bookings (0035), from wherever the owner is.
 *
 * ---------------------------------------------------------------------------
 * **One switch, three places, one column.** The rail on a desktop, the
 * overflow sheet on a phone and the settings page all render this and all call
 * `setBookingsPausedAction`, so there is nothing to keep in sync: each reads
 * `bookings_paused` from the server and the refresh after a change redraws all
 * of them, and the banner with them.
 *
 * **On means "clients can book".** The switch is phrased as the thing that is
 * normally true — "קבלת הזמנות אונליין", green and on — so pausing is turning
 * it *off*, which is what an owner reaching for it expects. A switch labelled
 * "pause" that is off in normal operation reads as broken the first time it is
 * glanced at.
 *
 * Optimistic: the thumb moves on the tap, and moves back with the error if the
 * write is refused.
 * ---------------------------------------------------------------------------
 */
export function BookingsPauseSwitch({
  paused,
  variant,
}: {
  paused: boolean;
  variant: "rail" | "sheet" | "settings";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = useTransition();

  /**
   * What the switch shows, reset **during render** when the server's value
   * changes — React's documented pattern for following a changed prop, and not
   * an effect whose only job is correcting the render before it.
   */
  const [shown, setShown] = useState(paused);
  const [from, setFrom] = useState(paused);
  if (from !== paused) {
    setFrom(paused);
    setShown(paused);
  }

  function toggle() {
    const next = !shown;
    setShown(next);

    startTransition(async () => {
      const result = await setBookingsPausedAction(next);
      if (!result.ok) {
        setShown(!next);
        toast(result.error, "error");
        return;
      }
      toast(next ? "ההזמנות אונליין הושהו" : "ההזמנות אונליין חודשו");
      router.refresh();
    });
  }

  const open = !shown;
  const status = open ? "פתוחות ללקוחות" : "מושהות";

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={open}
      aria-label="קבלת הזמנות אונליין"
      onClick={toggle}
      disabled={busy}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 disabled:cursor-wait",
        focusRing,
        open ? "bg-emerald-600" : "bg-amber-500",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200",
          // On is the far end, mirrored for the page's direction the way a
          // phone's own switches mirror: left in Hebrew, right in a
          // left-to-right page. Off rests at the start.
          open ? "-translate-x-5 ltr:translate-x-5" : "translate-x-0",
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-zinc-500" />
        ) : null}
      </span>
    </button>
  );

  if (variant === "settings") {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              קבלת הזמנות אונליין
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              כיבוי משהה מיד את קביעת התורים בעמוד ההזמנות: הלקוחות רואים הודעה
              ולא יכולים לבחור מועד, ורשימת ההמתנה לא שולחת הצעות. אתם ממשיכים
              להוסיף, לערוך ולהעביר תורים ביומן כרגיל.
            </p>
            <p
              className={cn(
                "mt-2 text-xs font-semibold",
                open
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-800 dark:text-amber-300",
              )}
            >
              {open ? "ההזמנות פתוחות ללקוחות" : "ההזמנות מושהות"}
            </p>
          </div>
          {control}
        </div>
      </section>
    );
  }

  return (
    <div
      className={cn(
        "glass-inset flex items-center gap-3 rounded-2xl",
        variant === "sheet" ? "px-4 py-3" : "px-3 py-2.5",
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-semibold text-zinc-900 dark:text-zinc-100",
            variant === "sheet" ? "text-sm" : "text-xs",
          )}
        >
          הזמנות אונליין
        </span>
        <span
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-[11px] font-medium",
            open
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-800 dark:text-amber-300",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              open ? "bg-emerald-500" : "bg-amber-500",
            )}
          />
          {status}
        </span>
      </span>
      {control}
    </div>
  );
}

/**
 * Shown at the top of every dashboard page's content while bookings are paused
 * — inside the content column, so it never pushes the navigation rail down.
 *
 * A pause is the kind of switch that is flipped on a Friday and forgotten by
 * Sunday, and the cost of forgetting is a week of clients who could not book.
 * So it is never silent: the banner says what the client sees and what still
 * works, and the way back is on it.
 */
export function PausedBanner() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = useTransition();

  function resume() {
    startTransition(async () => {
      const result = await setBookingsPausedAction(false);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }
      toast("ההזמנות אונליין חודשו");
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-400/20 px-4 py-3 backdrop-blur-md"
    >
      <p className="flex items-start gap-2 text-xs leading-relaxed font-semibold text-amber-950 dark:text-amber-100">
        <CirclePause className="mt-px size-4 shrink-0" aria-hidden />
        ההזמנות אונליין מושהות: הלקוחות רואים הודעה בעמוד ההזמנות ולא יכולים
        לקבוע תור. ביומן אפשר להמשיך לעבוד כרגיל.
      </p>
      <button
        type="button"
        onClick={resume}
        disabled={busy}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-amber-950 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-amber-900 disabled:opacity-70 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-white",
          focusRing,
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : null}
        חידוש ההזמנות
      </button>
    </div>
  );
}
