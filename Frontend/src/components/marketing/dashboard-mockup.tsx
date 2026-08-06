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
 * Rows are a three-column grid rather than a flex row, so times, names and
 * badges line up down the whole list instead of drifting with content width.
 * The badge column is fixed for the same reason: `ממתין` and `הבא בתור` are
 * different lengths, and a flex row would ragged-edge them.
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
  { time: "09:00", name: "יוסי כהן", service: "תספורת גבר", status: "next" },
  { time: "09:35", name: "דנה לוי", service: "עיצוב זקן", status: "confirmed" },
  {
    time: "10:10",
    name: "אורי מזרחי",
    service: "תספורת ילד",
    status: "pending",
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
        "w-full rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(9,9,11,0.06)] dark:bg-zinc-950",
        className,
      )}
    >
      <div aria-hidden>
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {/* Live indicator. Real semantic state, which is what earns it
                colour rather than being a decorative dot. */}
            <span className="size-2 shrink-0 rounded-full bg-[image:var(--brand-gradient)]" />
            היומן שלי
          </p>
          <p className="shrink-0 text-[10px] text-zinc-400">יום שני, 7.9</p>
        </div>

        {/* Hairline-divided columns rather than three bordered cards: at this
            scale a card inside a card is just noise. */}
        {/* Dropped on short viewports. The hero is capped at 70% of the
            screen, so on a 1280x700 laptop the full card cannot fit beside the
            copy and the actions: it overflowed the section and pushed the
            headline up under the header. The agenda is the part that sells the
            product; the summary numbers are the part that can go. */}
        <div className="grid grid-cols-3 divide-x divide-zinc-200 border-b border-zinc-200 divide-x-reverse dark:divide-zinc-800 dark:border-zinc-800 [@media(max-height:820px)]:hidden">
          {STATS.map(({ label, value }) => (
            <div key={label} className="px-3 py-3 first:ps-0 last:pe-0">
              <span className="block text-[10px] leading-none font-medium text-zinc-400">
                {label}
              </span>
              <span className="mt-1.5 block text-base leading-none font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
                {value}
              </span>
            </div>
          ))}
        </div>

        <ul className="mt-3 space-y-2">
          {AGENDA.map((row) => {
            const isNext = row.status === "next";
            return (
              <li
                key={row.time}
                className={cn(
                  // Fixed first and last tracks are what make the column edges
                  // line up regardless of how long a name or label runs.
                  // Padding is identical on every row, including the
                  // highlighted one. Giving that row extra `ps` to clear its
                  // rail pushed its time column 4px off the others, which is
                  // precisely the drift a fixed grid exists to prevent. The
                  // rail is 4px inside a 12px inset, so it needs no allowance.
                  "grid grid-cols-[3.25rem_1fr_4.5rem] items-center gap-3 rounded-xl px-3 py-2.5",
                  isNext
                    ? "relative overflow-hidden bg-violet-50 dark:bg-violet-950/30"
                    : "bg-zinc-50 dark:bg-zinc-900/60",
                )}
              >
                {isNext ? (
                  <span className="absolute inset-y-0 start-0 w-1 bg-[image:var(--brand-gradient)]" />
                ) : null}

                <span className="text-xs font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
                  {row.time}
                </span>

                <span className="min-w-0">
                  <span className="block truncate text-xs leading-tight font-semibold text-zinc-800 dark:text-zinc-200">
                    {row.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] leading-tight text-zinc-400">
                    {row.service}
                  </span>
                </span>

                <span
                  className={cn(
                    "inline-flex h-5 items-center justify-center rounded-full px-2 text-[9px] font-bold",
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
