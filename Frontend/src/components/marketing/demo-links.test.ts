import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two demo buttons, guarded at the source.
 *
 * ---------------------------------------------------------------------------
 * **Why a source assertion.** These are properties of a static className, not
 * of a function — there is no seam to call, and the failure mode is silent: a
 * button that still works, still looks bold, and is simply unreadable. The
 * house pattern for exactly this is `booking-page-shell.test.ts`; this follows
 * it, and targets the *mechanism* so a reflow passes and a rewrite fails.
 *
 * **What is actually at risk, now that the fill is a wash.** The buttons were
 * solid `amber-500` / `rose-500`, and the danger then was the label: white on
 * `amber-500` is **2.15:1**. That specific trap is gone, because the label is
 * no longer read against the fill — it is read against the page, which is what
 * a 10% wash effectively still is.
 *
 * The traps that replaced it are the reverse ones, and they are just as quiet:
 *
 * 1. **Restoring the solid fill** — the obvious "make it pop again" edit —
 *    puts a near-white or accent-coloured label back on a saturated 500 and
 *    reinstates the original failure at a stroke.
 * 2. **Colouring the label to match** (`text-amber-600` on an amber wash) is
 *    the natural instinct for a tinted button and lands somewhere near 3:1.
 *    Neutral ink is what holds this design at ~15:1.
 * 3. **Dropping the border** leaves a control that is a 10% wash away from the
 *    page, which is no longer visibly a button at all.
 *
 * None of the three looks wrong in a screenshot taken by whoever made it.
 * ---------------------------------------------------------------------------
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/marketing/demo-links.tsx"),
  "utf8",
);

const PAGE = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

/**
 * The `DEMOS` table alone — the per-shop surfaces. Scoped because the accent
 * legitimately appears at full strength elsewhere in this file (the dot), and
 * an assertion over the whole source could not tell the two apart.
 */
const DEMOS_BLOCK = SOURCE.slice(
  SOURCE.indexOf("const DEMOS = ["),
  SOURCE.indexOf("] as const;"),
);

describe("the demo buttons stay readable", () => {
  it("keeps both surfaces a translucent wash, never a solid fill", () => {
    expect(DEMOS_BLOCK).toMatch(/bg-amber-500\/1\d/);
    expect(DEMOS_BLOCK).toMatch(/bg-rose-500\/1\d/);

    // Every accent background in the table carries an alpha. The dot is the
    // one deliberate full-strength mark and is excluded by name — it sits
    // outside the text, so nothing is ever read against it.
    const surfaces = DEMOS_BLOCK.split("\n").filter(
      (line) => /bg-(amber|rose)-\d00/.test(line) && !line.includes("dot:"),
    );
    expect(surfaces.length).toBeGreaterThan(0);
    for (const line of surfaces) {
      expect(line).not.toMatch(/bg-(amber|rose)-\d00(?!\/)/);
    }
  });

  it("labels them in neutral ink, per theme, never in the accent", () => {
    // ~15:1 on the light wash, comparable on the dark one. The ink needs a
    // dark variant precisely because the surface now follows the theme.
    expect(SOURCE).toContain("text-zinc-900");
    expect(SOURCE).toContain("dark:text-zinc-50");

    // An unqualified white label would apply in light mode, over a near-white
    // wash. `dark:text-*` is a different thing and is allowed.
    expect(SOURCE).not.toMatch(/(?<!dark:)text-white/);

    // Tinting the label to match the button is the instinct this resists.
    expect(SOURCE).not.toMatch(/text-(amber|rose)-\d00/);
  });

  it("keeps a visible border, which is what makes the wash a control", () => {
    expect(DEMOS_BLOCK).toMatch(/border-amber-500\/\d\d/);
    expect(DEMOS_BLOCK).toMatch(/border-rose-500\/\d\d/);
  });

  it("keeps the accent at full strength somewhere it is safe", () => {
    // The dot is the whole of what the solid fill used to do. Losing it makes
    // the two buttons near-identical grey capsules.
    expect(DEMOS_BLOCK).toMatch(/dot: "bg-amber-500"/);
    expect(DEMOS_BLOCK).toMatch(/dot: "bg-rose-500"/);
  });
});

describe("the demo buttons carry no category glyphs", () => {
  it("imports no trade icon", () => {
    // Scissors and Sparkles were decoration standing in for a category the
    // label already names.
    for (const icon of ["Scissors", "Sparkles"]) {
      expect(SOURCE).not.toContain(icon);
    }
  });

  it("keeps the one icon that does a job", () => {
    // The new-tab indicator. It is not decoration: it is the only signal that
    // the click leaves the page, and it must not leave while `_blank` stays.
    expect(SOURCE).toContain("ArrowUpLeft");
  });
});

describe("the demo buttons open beside the page, and say so", () => {
  it("opens in a new tab without handing over a window handle", () => {
    expect(SOURCE).toMatch(/target="_blank"/);
    expect(SOURCE).toMatch(/rel="noopener"/);
  });

  it("announces the new tab to a screen reader", () => {
    // `target="_blank"` with no announcement springs the tab change on someone
    // who cannot see it happen.
    expect(SOURCE).toMatch(/sr-only[^>]*>\s*\(נפתח בכרטיסייה חדשה\)/);
  });
});

describe("the peek band is gone", () => {
  it("no longer offers a third, genericised demo link", () => {
    /**
     * A full-bleed band whose stated purpose was "a hard tonal change rather
     * than more of the same white" — a section of chrome earning its place by
     * being a different colour, carrying a single unlabelled demo CTA that the
     * hero now covers properly with two.
     */
    expect(PAGE).not.toContain("אפשר לראות איך זה נראה ללקוח");
  });

  it("closes the seam it left with a rule, like every section below", () => {
    // Without this the proof strip and HOW IT WORKS meet on one paper with
    // nothing between them, and the sections stop reading as separate.
    const howItWorks = PAGE.slice(PAGE.indexOf("HOW IT WORKS"));
    expect(howItWorks).toMatch(
      /<section className="[^"]*border-t border-zinc-200/,
    );
  });
});
