import Link from "next/link";
import { ArrowUpLeft, Scissors, Sparkles } from "lucide-react";

import { DEMO_NAILS_SLUG, DEMO_SLUG } from "@/lib/demo";
import { cn } from "@/lib/utils";

/**
 * The two live booking pages, offered side by side.
 *
 * ---------------------------------------------------------------------------
 * **One demo link became two because one was answering the wrong question.**
 * A visitor who cuts hair and a visitor who does nails both used to land on a
 * barber's page; the nail studio existed and was never linked from here. The
 * `demo.ts` comment already says why the second tenant was seeded — "a prospect
 * who runs a nail salon should see their own trade rather than a barber's" —
 * and the hero was the one place still ignoring it.
 *
 * **Each button wears its own shop's colour.** `demo-barber` is amber and
 * `demo-nails` is rose in the database, so the tint here is not a decorative
 * choice: it is a two-pixel preview of the page behind the link, and the
 * accent a visitor lands on is the one they just clicked.
 *
 * **They open in a new tab, which is what makes the indicator honest.** These
 * are internal routes, so an external-link glyph on a same-tab navigation
 * would be a lie — and a demo the visitor cannot get back from is a demo that
 * ends the visit. Opening beside the page means the arrow is true and the
 * landing page survives; the tab change is announced rather than sprung, since
 * a new window with no warning is disorienting for a screen-reader user.
 *
 * **Glass, and here it earns it.** These sit on the hero's grid-and-glow
 * ground, so a translucent pill lets the lattice run underneath while the label
 * stays readable. A solid fill would punch two opaque rectangles through the
 * one texture the section has.
 * ---------------------------------------------------------------------------
 */

const DEMOS = [
  {
    slug: DEMO_SLUG,
    label: "עמוד מספרה לדוגמא",
    Icon: Scissors,
    /**
     * Amber and rose are `theme_color` on the two rows. Written as literal
     * utilities rather than read from the database because this is a static
     * marketing page — and because Tailwind cannot build a class from a
     * runtime value, which is the same constraint `data-accent` exists for.
     */
    tint: "text-amber-600 dark:text-amber-400",
    halo: "bg-amber-500/12",
    edge: "group-hover:border-amber-500/45 group-hover:shadow-[0_10px_30px_-12px_rgb(245_158_11/0.4)]",
  },
  {
    slug: DEMO_NAILS_SLUG,
    label: "עמוד ציפורניים לדוגמא",
    Icon: Sparkles,
    tint: "text-rose-600 dark:text-rose-400",
    halo: "bg-rose-500/12",
    edge: "group-hover:border-rose-500/45 group-hover:shadow-[0_10px_30px_-12px_rgb(244_63_94/0.4)]",
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
        {DEMOS.map(({ slug, label, Icon, tint, halo, edge }) => (
          <Link
            key={slug}
            href={`/${slug}`}
            target="_blank"
            // `noopener` is the one that matters: it denies the opened page a
            // handle back to this window. `noreferrer` is not added, because
            // these are our own routes and the referrer is useful.
            rel="noopener"
            className={cn(
              "group inline-flex h-12 w-full items-center gap-3 rounded-full ps-2 pe-4 sm:w-auto",
              // The glass itself. Held at 70% so the grid reads through and
              // the label still clears AA on either ground.
              "border border-zinc-900/10 bg-white/70 backdrop-blur-md dark:border-white/12 dark:bg-zinc-900/60",
              "shadow-[0_1px_2px_-1px_rgb(24_24_27/0.08),0_8px_20px_-12px_rgb(24_24_27/0.25)]",
              // Colour, lift and shadow arrive together on hover, and only
              // where a pointer exists. `motion-safe` keeps the scale off for
              // anyone who asked for less movement; the accessibility widget's
              // blanket rule covers the rest.
              "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
              "active:scale-[0.99] motion-safe:hover:scale-[1.02]",
              "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-white dark:focus-visible:ring-offset-zinc-950",
              edge,
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                halo,
                tint,
              )}
            >
              <Icon className="size-4" strokeWidth={2} aria-hidden />
            </span>

            <span className="flex-1 text-start text-sm font-semibold whitespace-nowrap text-zinc-900 dark:text-zinc-100">
              {label}
              <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
            </span>

            {/* Points away from the page, and moves that way on hover. In RTL
                "away" is up and to the left, which is the direction this arrow
                already has — no mirroring needed. */}
            <ArrowUpLeft
              className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 dark:text-zinc-500"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
