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
 * **Each button carries its own shop's colour.** `demo-barber` is amber and
 * `demo-nails` is rose in the database, so these are not decorative picks: the
 * colour is a preview of the page behind the link, and the accent a visitor
 * lands on is the one they just clicked.
 *
 * **A tinted wash and a real border, not a saturated fill.** These were solid
 * `amber-500` / `rose-500` blocks, which read as heavy against a page that is
 * otherwise a hairline grid and one glow, and shouted louder than the primary
 * call to action above them. The fill is now the same hue at low alpha with a
 * border at the same hue, which keeps the identity and returns the weight.
 *
 * **The contrast problem moved rather than went away, and the new answer is
 * structural.** The old fill was the surface behind the label, so the label had
 * to be measured against a saturated 500 — white on `amber-500` is **2.15:1**,
 * one of the most common contrast failures there is, which is why that ink was
 * near-black. A 10% wash is within a hair of the page it sits on, so the label
 * is now measured against **the page**: `zinc-900` on the light wash is about
 * **15:1**, `zinc-50` on the dark one is comparable. That is a wider margin
 * than the old design had, and it is why the ink now needs a `dark:` variant
 * where it previously did not — the surface follows the theme now, and a single
 * near-black ink that worked on amber in both themes would be invisible on a
 * near-black page.
 *
 * **The saturation lives in the dot.** Dropping a full-strength fill costs
 * exactly the vibrance these buttons existed for, so the 500 survives at full
 * strength in a small mark rather than across the whole control. It sits
 * outside the text, so nothing is read against it.
 *
 * **Hover deepens the wash, which is safe here in a way it was not before.**
 * The old hover could not step the fill to a 600 — on rose that lands at
 * **4.24:1**, under the floor, in a state no screenshot review looks at. With
 * the label measured against the page rather than against the fill, moving a
 * 10% wash to 18% changes the label's contrast by a fraction of a point and
 * leaves it far above the floor.
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
     *
     * The wash lifts one step in dark mode. The same 10% of amber that reads
     * as a warm tint on white is nearly invisible on `zinc-950`, because the
     * surface it is mixing into stopped being bright.
     */
    tint: cn(
      "border-amber-500/45 bg-amber-500/10",
      "hover:border-amber-500/70 hover:bg-amber-500/18",
      "dark:border-amber-400/40 dark:bg-amber-400/12",
      "dark:hover:border-amber-400/65 dark:hover:bg-amber-400/20",
      "hover:shadow-[0_10px_30px_-14px_rgb(245_158_11/0.5)]",
    ),
    dot: "bg-amber-500",
  },
  {
    slug: DEMO_NAILS_SLUG,
    label: "עמוד ציפורניים לדוגמא",
    tint: cn(
      "border-rose-500/45 bg-rose-500/10",
      "hover:border-rose-500/70 hover:bg-rose-500/18",
      "dark:border-rose-400/40 dark:bg-rose-400/12",
      "dark:hover:border-rose-400/65 dark:hover:bg-rose-400/20",
      "hover:shadow-[0_10px_30px_-14px_rgb(244_63_94/0.5)]",
    ),
    dot: "bg-rose-500",
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
        {DEMOS.map(({ slug, label, tint, dot }) => (
          <Link
            key={slug}
            href={`/${slug}`}
            target="_blank"
            // `noopener` is the one that matters: it denies the opened page a
            // handle back to this window. `noreferrer` is not added, because
            // these are our own routes and the referrer is useful.
            rel="noopener"
            className={cn(
              "group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full border px-5 sm:w-auto",
              // Measured against the page, not against the fill — see the note
              // above for why this needs a dark variant and the old ink did not.
              "text-sm font-bold whitespace-nowrap text-zinc-900 dark:text-zinc-50",
              // Glass: the wash is thin enough that what is behind it matters,
              // and the landing page puts a hairline grid and a glow back there.
              "backdrop-blur-sm",
              tint,
              // Lift and glow arrive together, and the scale only where a
              // pointer exists and the visitor has not asked for less motion.
              "transition-[transform,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "active:scale-[0.99] motion-safe:hover:scale-[1.02]",
              "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950",
            )}
          >
            {/* The shop's colour at full strength, where no text is read
                against it. This is the whole of what the solid fill used to
                do, kept at 8px so it informs without weighing. */}
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", dot)}
            />

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
