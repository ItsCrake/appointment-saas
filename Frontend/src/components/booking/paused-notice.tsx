"use client";

import { CirclePause, Phone } from "lucide-react";

import { useCopy } from "./copy-context";

/**
 * What a client sees when the shop has paused online bookings (0035).
 *
 * ---------------------------------------------------------------------------
 * **Glass in the tenant's own colour**, because this is the tenant's page: the
 * notice is `.booking-notice`, which mixes `--accent` into a frosted panel over
 * the page's own ambient ground, and its icon sits on `--accent-soft`, the pair
 * `theme-coverage.test.ts` already holds to AA for every swatch.
 *
 * **It says what is true and offers the one thing that still works.** The shop
 * is not closed — the owner paused this page — so it does not say closed, and
 * it does not promise a time nobody has given. Where the shop has a phone
 * number the notice carries a call button: degrade to something, never to
 * nothing.
 *
 * `role="status"`, so a screen reader announces it when a client who was
 * already in the flow is switched into the paused state by a refusal.
 * ---------------------------------------------------------------------------
 */
export function PausedNotice({ phone }: { phone: string | null }) {
  const t = useCopy();

  return (
    <div
      role="status"
      className="booking-notice mx-5 mb-5 flex items-start gap-3.5 p-4"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-(--accent-on-soft)">
        <CirclePause className="size-5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-semibold text-zinc-900 dark:text-zinc-50">
          {t("paused.title", "ההזמנות אונליין מושהות כרגע")}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {t(
            "paused.body",
            "העסק השהה זמנית את קביעת התורים בעמוד הזה. נסו שוב בקרוב.",
          )}
        </p>

        {phone ? (
          <a
            href={`tel:${phone}`}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-(--accent) px-4 text-sm font-semibold text-(--accent-contrast) transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Phone className="size-4" aria-hidden />
            {t("paused.call", "לתיאום בטלפון")}
          </a>
        ) : null}
      </div>
    </div>
  );
}
