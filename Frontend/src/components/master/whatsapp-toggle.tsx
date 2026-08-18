"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, MessageCircleOff } from "lucide-react";

import { setWhatsappDispatchAction } from "@/app/master/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * The WhatsApp cost guard, as a switch.
 *
 * ---------------------------------------------------------------------------
 * Two things this control refuses to do, both because it decides whether real
 * clients are told anything at all.
 *
 * **It never shows a state it is not in.** The optimistic flip is rolled back
 * on failure, and `envLocked` disables the control outright rather than letting
 * it move and silently do nothing — `DISABLE_WHATSAPP_DISPATCH` cannot be
 * cleared from a web UI, so a switch that appeared to turn sending back on
 * would be lying. A live-looking setting that changes nothing is worse than an
 * absent one.
 *
 * **Sending is the state that has to justify itself.** So "on" is the quiet
 * neutral and "suppressed" is the one wearing amber — the reverse of the usual
 * green-is-good habit, because here the expensive state is the unremarkable
 * one and the operator needs to notice when messages are muted, not when they
 * are flowing.
 * ---------------------------------------------------------------------------
 */
export function WhatsappToggle({
  disabled,
  envLocked,
  updatedBy,
  updatedAt,
}: {
  disabled: boolean;
  /** `DISABLE_WHATSAPP_DISPATCH` is set, so this toggle cannot lift it. */
  envLocked: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}) {
  const [on, setOn] = useState(disabled);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  const suppressed = on || envLocked;

  function flip() {
    const next = !on;
    const previous = on;
    setOn(next); // optimistic

    startTransition(async () => {
      const result = await setWhatsappDispatchAction({ disabled: next });
      if (result.ok) {
        toast(result.message ?? "עודכן");
        router.refresh();
      } else {
        setOn(previous); // roll back rather than show a state we are not in
        toast(result.error, "error");
      }
    });
  }

  return (
    <section
      className={cn(
        "rounded-3xl border p-5 transition-colors",
        suppressed
          ? "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {suppressed ? (
              <MessageCircleOff
                className="size-4 shrink-0 text-amber-700 dark:text-amber-400"
                aria-hidden
              />
            ) : (
              <MessageCircle
                className="size-4 shrink-0 text-zinc-400"
                aria-hidden
              />
            )}
            שליחת וואטסאפ
          </h2>

          {/* Status in words, never carried by colour alone. */}
          <p
            className={cn(
              "mt-1 text-sm font-semibold",
              suppressed
                ? "text-amber-800 dark:text-amber-300"
                : "text-zinc-700 dark:text-zinc-300",
            )}
          >
            {suppressed ? "מושבתת — לא נשלחות הודעות" : "פעילה — הודעות נשלחות"}
          </p>

          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {suppressed
              ? "ההודעות נרשמות ומסומנות כ״דילוג״, ולא נשלחת אף בקשה ל-Meta. לא נצבר חיוב."
              : "כל אישור ותזכורת נשלחים ללקוחות דרך Meta. כל הודעה עולה כסף."}
          </p>

          {envLocked ? (
            <p className="mt-3 rounded-xl bg-amber-100/70 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              משתנה הסביבה <code>DISABLE_WHATSAPP_DISPATCH</code> מוגדר בפריסה
              הזו, ולכן השליחה מושבתת בכל מקרה. אי אפשר לבטל אותו מכאן — יש
              להסיר אותו מהסביבה ולפרוס מחדש.
            </p>
          ) : null}

          {updatedBy && updatedAt ? (
            <p className="mt-2 text-[11px] text-zinc-500">
              שונה לאחרונה על ידי {updatedBy} · {updatedAt}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={suppressed}
          aria-label="השבתת שליחת וואטסאפ"
          disabled={pending || envLocked}
          onClick={flip}
          className={cn(
            "relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
            "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950",
            suppressed ? "bg-amber-600" : "bg-zinc-300 dark:bg-zinc-700",
          )}
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform",
              // RTL: the knob travels the other way, so the sign is inverted
              // against what an LTR layout would use.
              suppressed ? "-translate-x-6" : "-translate-x-1",
            )}
          >
            {pending ? (
              <Loader2
                className="size-3 animate-spin text-zinc-500"
                aria-hidden
              />
            ) : null}
          </span>
        </button>
      </div>
    </section>
  );
}
