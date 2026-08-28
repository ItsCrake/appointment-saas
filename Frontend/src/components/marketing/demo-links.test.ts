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
 * **What is actually at risk.** The obvious edit to a saturated fill is white
 * label text, and on `amber-500` that measures **2.15:1** — under a third of
 * the AA floor, and one of the most common contrast failures on the web. The
 * second obvious edit is a hover that steps to 600, which on rose lands at
 * **4.24:1**: under the floor, on hover only, in a state no screenshot review
 * ever looks at. Both are improvements to make and both break the button.
 * ---------------------------------------------------------------------------
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src/components/marketing/demo-links.tsx"),
  "utf8",
);

const PAGE = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

describe("the demo buttons stay readable", () => {
  it("keeps both fills at the saturated 500", () => {
    // The vibrance is the point. A darker shade would pass with white text and
    // lose the thing these buttons exist for.
    expect(SOURCE).toContain("bg-amber-500");
    expect(SOURCE).toContain("bg-rose-500");
  });

  it("labels them in ink, never in white", () => {
    // 9.26:1 and 5.42:1. White would be 2.15:1 and 3.67:1.
    expect(SOURCE).toContain("text-zinc-950");
    expect(SOURCE).not.toMatch(/text-white/);
  });

  it("brightens on hover instead of deepening the fill", () => {
    expect(SOURCE).toContain("hover:brightness-");
    expect(SOURCE).not.toMatch(/hover:bg-(amber|rose)-[6-9]00/);
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
