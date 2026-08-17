import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * What today is, in one line, above the agenda.
 *
 * ---------------------------------------------------------------------------
 * This replaced six equal-weight metric cards, and the reason is the screen's
 * job rather than a preference about cards.
 *
 * `/dashboard` is opened between clients, on a phone, by someone who wants to
 * know who is next. Six cards at `grid-cols-2` is **three rows** of numbers
 * before the first appointment is visible, and equal weight told the owner
 * nothing about which of the six to read. Two of them were 30-day rates —
 * cancellations and no-shows — which is analysis, not the next hour, and which
 * rendered "—" for every shop with fewer than five past bookings. A new owner's
 * first impression of their own dashboard was two empty boxes.
 *
 * So: today's two numbers are a sentence, the rest open on request, and nothing
 * was deleted. The four secondary figures are still here — one tap away, and
 * still reachable by a Starter tenant, which matters because `/dashboard/analytics`
 * is Pro-gated and moving the rates there would have taken them away.
 *
 * `<details>`/`<summary>` rather than React state: native disclosure is
 * keyboard-operable and screen-reader-announced for free, needs no hydration on
 * a page that is otherwise a server component, and the whole row is the target
 * — which is the right size for a thumb.
 * ---------------------------------------------------------------------------
 */

export type TodaySummaryProps = {
  todayCount: number;
  weekCount: number;
  upcomingCount: number;
  pastCount: number;
  cancelledCount: number;
  noShowCount: number;
  cancellationRate: number;
  noShowRate: number;
  ratesWindowDays: number;
  todayRevenueCents: number;
  newClientsThisWeek: number;
};

export function TodaySummary({
  todayCount,
  weekCount,
  pastCount,
  cancelledCount,
  noShowCount,
  cancellationRate,
  noShowRate,
  ratesWindowDays,
  todayRevenueCents,
  newClientsThisWeek,
}: TodaySummaryProps) {
  // With almost no history a percentage is noise — 1 of 2 is not "50%".
  const ratesAreMeaningful = pastCount >= 5;

  return (
    <details className="group mb-6">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl",
          "border border-zinc-200 bg-white px-4 py-3 transition-colors",
          "hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none",
          "dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60 dark:focus-visible:ring-white",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        {/* The sentence an owner would say out loud, at a size they can read at
            arm's length. `tabular-nums` so the figure does not jump width when
            a booking lands and the page refreshes. */}
        <p className="text-base font-semibold text-zinc-900 tabular-nums dark:text-zinc-50">
          {todayCount === 0 ? (
            <span className="font-medium text-zinc-500">אין תורים היום</span>
          ) : (
            <>
              היום {todayCount === 1 ? "תור אחד" : `${todayCount} תורים`}
              {todayRevenueCents > 0 ? (
                <>
                  <span
                    aria-hidden
                    className="mx-2 text-zinc-300 dark:text-zinc-700"
                  >
                    ·
                  </span>
                  {/* "Expected" is doing real work: nothing in this product
                      records a payment, so this is the value of today's
                      bookings, not takings. */}
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">
                    צפי {formatPrice(todayRevenueCents)}
                  </span>
                </>
              ) : null}
            </>
          )}
        </p>

        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500">
          <span className="group-open:hidden">עוד נתונים</span>
          <span className="hidden group-open:inline">פחות</span>
          <Chevron />
        </span>
      </summary>

      {/* Not cards. Label above value, separated by rules rather than by six
          boxes, so the eye reads a list instead of scanning a grid. */}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 rounded-2xl border border-zinc-200 bg-white px-4 py-1 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Figure label="השבוע" value={String(weekCount)} hint="מיום ראשון" />
        <Figure
          label="לקוחות חדשים"
          value={String(newClientsThisWeek)}
          hint="שהזמינו לראשונה השבוע"
        />
        <Figure
          label="ביטולים"
          value={ratesAreMeaningful ? `${cancellationRate}%` : "—"}
          hint={
            ratesAreMeaningful
              ? `${cancelledCount} מתוך ${pastCount}`
              : "אין מספיק נתונים"
          }
          warn={ratesAreMeaningful && cancellationRate >= 20}
        />
        <Figure
          label="לא הגיעו"
          value={ratesAreMeaningful ? `${noShowRate}%` : "—"}
          hint={
            ratesAreMeaningful
              ? `${noShowCount} מתוך ${pastCount}`
              : `${ratesWindowDays} ימים אחרונים`
          }
          warn={ratesAreMeaningful && noShowRate >= 15}
        />
      </dl>
    </details>
  );
}

function Figure({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="border-b border-zinc-100 py-3 last:border-0 sm:border-0 dark:border-zinc-800">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd>
        <span
          className={cn(
            "mt-1 block text-xl leading-none font-bold tabular-nums",
            // Never hue alone: the warning reads as a colour *and* the figure
            // beside it says how many out of how many.
            warn
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-900 dark:text-zinc-50",
          )}
        >
          {value}
        </span>
        {/* zinc-500, not zinc-400 — the lighter step measures 2.6:1 on white
            and fails AA, which is the same failure the booking page was lifted
            off. */}
        <span className="mt-1 block text-xs text-zinc-500">{hint}</span>
      </dd>
    </div>
  );
}

/** Rotates on open. `group-open` is the native `[open]` attribute, not state. */
function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 transition-transform duration-200 group-open:rotate-180"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
