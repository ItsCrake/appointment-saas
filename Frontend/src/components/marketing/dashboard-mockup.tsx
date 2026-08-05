import { cn } from "@/lib/utils";

/**
 * A scaled-down render of the real agenda, not a picture of one. It uses the
 * product's own row shape, status vocabulary and Hebrew service names, so what
 * a visitor sees here is what they get after signup.
 *
 * Deliberately no browser chrome. Traffic-light dots and a fake address bar
 * are what turn a preview into a mock screenshot, and a mock screenshot is a
 * promise the product has to keep twice.
 *
 * The brand gradient appears exactly twice: the live indicator and the next
 * appointment. Both are things that are *currently happening*, which is the
 * rule for colour on this page. Spending it on decoration instead would leave
 * nothing to mark the one row that matters.
 *
 * Announced as a single image with one description rather than as a dozen
 * headings and list items: the figures below are illustrative, and a screen
 * reader walking them row by row would be reading fiction.
 */

/** Illustrative figures. Not real data, and never presented as measured. */
const STATS = [
  { label: "תורים היום", value: "12" },
  { label: "הכנסה צפויה", value: "₪840" },
  { label: "חלונות פנויים", value: "3" },
] as const;

const AGENDA = [
  {
    time: "09:00",
    name: "יוסי כהן",
    service: "תספורת גבר",
    status: "next",
  },
  { time: "09:35", name: "דנה לוי", service: "עיצוב זקן", status: "confirmed" },
  {
    time: "10:10",
    name: "אורי מזרחי",
    service: "תספורת ילד",
    status: "pending",
  },
  {
    time: "10:35",
    name: "רון ברק",
    service: "תספורת גבר",
    status: "confirmed",
  },
] as const;

/**
 * Status is carried by weight first and colour second: filled ink for
 * confirmed, outline for pending, gradient only for the one that is next up.
 * The label is always rendered beside it, so nothing rests on fill alone.
 */
const STATUS = {
  next: {
    label: "הבא בתור",
    className: "bg-[image:var(--brand-gradient)] text-white",
  },
  confirmed: {
    label: "מאושר",
    className: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
  },
  pending: {
    label: "ממתין",
    className:
      "border border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400",
  },
} as const;

export function DashboardMockup({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="תצוגה מקדימה של לוח הבקרה: תורים היום, הכנסה צפויה, חלונות פנויים, וסדר היום עם סטטוס לכל תור"
      className={cn(
        "w-full rounded-3xl border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(9,9,11,0.04),0_24px_48px_-24px_rgba(9,9,11,0.22)] sm:p-5 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      <div aria-hidden>
        <div className="flex items-baseline justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {/* Live indicator. Real semantic state, which is what earns it
                colour rather than being a decorative dot. */}
            <span className="size-2 rounded-full bg-[image:var(--brand-gradient)]" />
            היומן שלי
          </p>
          <p className="text-[10px] text-zinc-400">יום שני, 7 בספטמבר</p>
        </div>

        {/* Hairline-divided columns rather than three bordered cards: at this
            scale a card inside a card is just noise. */}
        <div className="grid grid-cols-3 divide-x divide-zinc-200 border-b border-zinc-200 divide-x-reverse dark:divide-zinc-800 dark:border-zinc-800">
          {STATS.map(({ label, value }) => (
            <div key={label} className="px-2 py-3 first:ps-0 last:pe-0">
              <span className="block text-[10px] font-medium text-zinc-400">
                {label}
              </span>
              <span className="mt-1 block text-lg leading-none font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
                {value}
              </span>
            </div>
          ))}
        </div>

        <ul className="mt-3 space-y-1.5">
          {AGENDA.map((row) => {
            const isNext = row.status === "next";
            return (
              <li
                key={row.time}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5",
                  isNext
                    ? // A tinted well plus a gradient rail, so the row reads as
                      // lifted without a second card border inside the card.
                      "relative overflow-hidden bg-violet-50/70 ps-4 dark:bg-violet-950/25"
                    : "bg-zinc-50/70 dark:bg-zinc-900/50",
                )}
              >
                {isNext ? (
                  <span className="absolute inset-y-0 start-0 w-1 bg-[image:var(--brand-gradient)]" />
                ) : null}
                <span className="text-xs font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {row.time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {row.name}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-400">
                    {row.service}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold",
                    STATUS[row.status].className,
                  )}
                >
                  {STATUS[row.status].label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
