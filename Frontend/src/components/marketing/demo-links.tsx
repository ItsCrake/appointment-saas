import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "@/lib/demo";
import { cn } from "@/lib/utils";

/**
 * The two live booking pages, offered side by side.
 *
 * ---------------------------------------------------------------------------
 * **One demo link became two because one was answering the wrong question.**
 * A visitor who cuts hair and a visitor who does nails both used to land on a
 * barber's page; the nail studio existed and was linked from nowhere. The
 * `demo.ts` comment already says why that tenant was seeded — "a prospect who
 * runs a nail salon should see their own trade rather than a barber's".
 *
 * **Each button is filled with its own shop's colour.** `demo-barber` is amber
 * and `demo-nails` is rose in the database, so these are not decorative picks:
 * the fill is a preview of the page behind the link, and the accent a visitor
 * lands on is the one they just clicked.
 *
 * **Ink on a 500, not white.** White on `amber-500` measures **2.15:1** and on
 * `rose-500` **3.67:1** — both far under AA, and amber with white is one of the
 * most common contrast failures there is. Dropping the fill to a shade dark
 * enough for white text (amber-700, rose-700) would have cost exactly the
 * vibrance these buttons exist for. Near-black on the saturated 500 keeps the
 * colour at full strength and measures **9.26:1** and **5.42:1**.
 *
 * The same pair works in dark mode untouched, which is why there is no `dark:`
 * variant on the fill or the label: a saturated 500 reads as loud on white
 * *and* on near-black, and the ink stays legible on both because the fill —
 * not the page — is what sits behind it.
 *
 * **Hover brightens rather than deepens.** The obvious hover is a step to 600,
 * and on rose that lands at 4.24:1 — under the floor, on hover only, where it
 * would never be caught. Brightening moves contrast the safe way.
 *
 * **They open in a new tab, which is what makes the arrow honest.** These are
 * internal routes, so an external-link indicator on a same-tab navigation
 * would be a lie. Opening beside the page also means the landing page survives
 * the click, and the tab change is announced rather than sprung.
 * ---------------------------------------------------------------------------
 */

const DEMOS = [
  {
    slug: DEMO_SLUG,
    label: "עמוד מספרה לדוגמא",
    /**
     * Literal utilities rather than values read from the database: this is a
     * static marketing page, and Tailwind cannot build a class from a runtime
     * value — the same constraint `data-accent` exists for.
     */
    fill: "bg-amber-500 hover:shadow-[0_10px_30px_-10px_rgb(245_158_11/0.55)]",
  },
  {
    slug: DEMO_NAILS_SLUG,
    label: "עמוד ציפורניים לדוגמא",
    fill: "bg-rose-500 hover:shadow-[0_10px_30px_-10px_rgb(244_63_94/0.55)]",
  },
] as const;

export function DemoLinks() {
  return (
    <div>
      <p className="mb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        רוצים לראות קודם? שני עמודים אמיתיים, פתוחים לכולם:
      </p>

      {/* Width, never flex, controls the mobile stack — `flex-1` in a
          flex-col parent sizes the cross axis and silently crushes a fixed
          height, which is the bug the buttons above this already carry a note
          about. */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        {DEMOS.map(({ slug, label, fill }) => (
          <Link
            key={slug}
            href={`/${slug}`}
            target="_blank"
            // `noopener` is the one that matters: it denies the opened page a
            // handle back to this window. `noreferrer` is not added, because
            // these are our own routes and the referrer is useful.
            rel="noopener"
            className={cn(
              "group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 sm:w-auto",
              // Ink, on both fills, in both themes — see the note above.
              "text-sm font-bold whitespace-nowrap text-zinc-950",
              fill,
              "shadow-[0_1px_2px_-1px_rgb(24_24_27/0.12),0_6px_16px_-8px_rgb(24_24_27/0.25)]",
              // Lift and glow arrive together, and the scale only where a
              // pointer exists and the visitor has not asked for less motion.
              "transition-[transform,box-shadow,filter] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "hover:brightness-[1.06] active:scale-[0.99] motion-safe:hover:scale-[1.02]",
              "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950",
            )}
          >
            <span>
              {label}
              <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
            </span>

            {/* Kept deliberately. It is not a category glyph — it is the
                indicator that this opens a new tab, and dropping it while
                keeping `target="_blank"` would leave that unsignalled. In RTL
                "away from the page" is up and to the left, which is the
                direction this arrow already points. */}
            <ArrowUpLeft
              className="size-4 shrink-0 opacity-70 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-0.5 group-hover:-translate-y-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
