import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveScreenshot,
  SCREENSHOT_SLOTS,
  type ScreenshotSlot,
} from "@/lib/screenshots";

/**
 * The landing page's screenshots, and the ways they go wrong quietly.
 *
 * ---------------------------------------------------------------------------
 * A `src` pointing at a file that is not there does not fail typecheck and does
 * not throw — it renders a broken image on the page whose whole job is
 * convincing a shop owner the product is real. `PhoneFrame` catches that at
 * runtime and swaps in the drawn mockup; this is what stops the net being
 * needed.
 *
 * Since the HD folder exists, there is a second failure mode: a replacement
 * that is *smaller* than the file it replaces, which would look like an
 * upgrade and be a downgrade.
 * ---------------------------------------------------------------------------
 */

const MARKETING = path.resolve(process.cwd(), "src/components/marketing");
const SHOTS = path.resolve(process.cwd(), "public/screenshots");

/**
 * The frame caps the image at 284 CSS px (`max-w-[19rem]` minus its padding),
 * so a 3× phone needs 852 real pixels. Anything narrower is upscaled.
 */
const MIN_WIDTH_FOR_3X = 852;

/** Files only — `hd/` is a directory and `README.md` documents it. */
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

  it("reads real dimensions rather than assuming the original shape", () => {
    /**
     * The originals are all 736×1600. An HD replacement is a different size —
     * an iPhone capture is 1179×2556 — and a hardcoded ratio that disagreed
     * with the file would distort it. So this asserts the *shape*, not a
     * constant: a portrait phone screen, roughly 0.46 wide-to-tall.
     */
    for (const slot of SCREENSHOT_SLOTS) {
      const { width, height } = resolveScreenshot(slot);
      expect(height).toBeGreaterThan(width);
      expect(width / height).toBeGreaterThan(0.4);
      expect(width / height).toBeLessThan(0.52);
    }
  });

  it("refuses an HD file narrower than the one it replaces", () => {
    /**
     * The whole point of the folder. A 640px "HD" capture would resolve
     * cleanly, look like an upgrade, and be softer than the 736px original it
     * shadowed — the exact mistake this folder invites.
     */
    for (const slot of SCREENSHOT_SLOTS) {
      const shot = resolveScreenshot(slot);
      if (!shot.hd) continue;

      expect(
        shot.width,
        `${slot}: HD file is ${shot.width}px, narrower than the ${MIN_WIDTH_FOR_3X}px a 3× display needs`,
      ).toBeGreaterThanOrEqual(MIN_WIDTH_FOR_3X);
    }
  });

  it("uses web-safe filenames in both folders", () => {
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
    for (const name of imageFiles(path.join(SHOTS, "hd"))) {
      expect(name, `hd/${name} needs a web-safe name`).toMatch(safe);
      const slot = name.replace(/\.[a-z]+$/, "") as ScreenshotSlot;
      expect(
        SCREENSHOT_SLOTS as readonly string[],
        `hd/${name} does not match any slot, so nothing will ever load it`,
      ).toContain(slot);
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
