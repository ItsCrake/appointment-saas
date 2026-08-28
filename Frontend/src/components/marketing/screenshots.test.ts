import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveScreenshot, SCREENSHOT_SLOTS } from "@/lib/screenshots";

/**
 * The landing page's screenshots, and the ways they go wrong quietly.
 *
 * ---------------------------------------------------------------------------
 * A `src` pointing at a file that is not there does not fail typecheck and does
 * not throw — it renders a broken image on the page whose whole job is
 * convincing a shop owner the product is real. `PhoneFrame` catches that at
 * runtime and swaps in the drawn mockup; this is what stops the net being
 * needed.
 * ---------------------------------------------------------------------------
 */

const MARKETING = path.resolve(process.cwd(), "src/components/marketing");
const SHOTS = path.resolve(process.cwd(), "public/screenshots");

/** Files only, so a stray directory does not fail the name check. */
const imageFiles = (dir: string) =>
  readdirSync(dir).filter(
    (name) => statSync(path.join(dir, name)).isFile() && name !== "README.md",
  );

describe("screenshot slots", () => {
  it("resolves every declared slot to a real file", () => {
    // `resolveScreenshot` throws when a slot has neither an HD nor a base file,
    // which is the behaviour worth pinning: a missing slot should stop the
    // build rather than reach a visitor.
    for (const slot of SCREENSHOT_SLOTS) {
      const shot = resolveScreenshot(slot);
      expect(shot.src.startsWith("/screenshots/")).toBe(true);
      expect(shot.width).toBeGreaterThan(0);
      expect(shot.height).toBeGreaterThan(0);
    }
  });

  it("reads real dimensions rather than assuming a constant", () => {
    /**
     * Asserts the *shape* rather than the numbers: a portrait phone screen,
     * roughly 0.46 wide-to-tall. A hardcoded `width`/`height` that disagreed
     * with the file would distort it, and re-capturing a screen at a different
     * device size must not silently start squashing it.
     */
    for (const slot of SCREENSHOT_SLOTS) {
      const { width, height } = resolveScreenshot(slot);
      expect(height).toBeGreaterThan(width);
      expect(width / height).toBeGreaterThan(0.4);
      expect(width / height).toBeLessThan(0.52);
    }
  });

  it("uses web-safe filenames", () => {
    /**
     * These arrived as "WhatsApp Image 2026-08-26 at 19.49.27 (1).jpeg".
     * Spaces and parentheses survive a local dev server and then need
     * percent-encoding everywhere else — the kind of thing that works until it
     * is deployed.
     */
    const safe = /^[a-z0-9-]+\.(jpg|jpeg|png|webp|avif)$/;

    for (const name of imageFiles(SHOTS)) {
      expect(name, `${name} needs a web-safe name`).toMatch(safe);
    }
  });

  it("gives every screenshot a drawn fallback", () => {
    /**
     * `PhoneFrame` renders `fallback` when the file cannot be loaded. A usage
     * without one shows an empty frame — worse than the CSS mockup this page
     * shipped with, and worse than nothing.
     */
    for (const name of readdirSync(MARKETING)) {
      if (!name.endsWith(".tsx")) continue;
      const source = readFileSync(path.join(MARKETING, name), "utf8");
      const uses = source.match(/<PhoneFrame\b/g)?.length ?? 0;
      if (uses === 0) continue;

      const fallbacks = source.match(/fallback=\{/g)?.length ?? 0;
      expect(fallbacks, `${name} has ${uses} PhoneFrame(s)`).toBe(uses);
    }
  });

  it("describes what each screenshot shows, in Hebrew", () => {
    // These are the only images on the page carrying product information, so
    // the alt text is what a screen reader gets instead of the feature.
    for (const name of readdirSync(MARKETING)) {
      if (!name.endsWith(".tsx")) continue;
      const source = readFileSync(path.join(MARKETING, name), "utf8");
      if (!source.includes("<PhoneFrame")) continue;

      for (const match of source.matchAll(/alt[=:]\s*["']([^"']*)["']/g)) {
        const alt = match[1];
        expect(
          alt.length,
          `${name}: alt "${alt}" is too terse`,
        ).toBeGreaterThan(15);
        expect(alt, `${name}: alt should be Hebrew`).toMatch(/[֐-׿]/);
      }
    }
  });
});
