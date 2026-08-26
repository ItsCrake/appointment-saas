import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The landing page's screenshots, and the two ways they go missing quietly.
 *
 * ---------------------------------------------------------------------------
 * A `src` pointing at a file that is not there does not fail the build, does
 * not fail typecheck, and does not throw at runtime — it renders a broken
 * image on the page whose entire job is convincing a shop owner the product is
 * real. `PhoneFrame` catches that at runtime and swaps in the drawn mockup,
 * which is the safety net; this is the thing that stops the net ever being
 * needed.
 *
 * Source assertions, like `booking-page-shell.test.ts`: the property is "does
 * this string match a file on disk", which no unit test of a component can
 * reach.
 * ---------------------------------------------------------------------------
 */

const MARKETING = path.resolve(process.cwd(), "src/components/marketing");
const PUBLIC = path.resolve(process.cwd(), "public");

/** Every `/screenshots/…` path referenced anywhere in the marketing folder. */
function referencedScreenshots(): { file: string; src: string }[] {
  const found: { file: string; src: string }[] = [];
  for (const name of readdirSync(MARKETING)) {
    if (!name.endsWith(".tsx")) continue;
    const source = readFileSync(path.join(MARKETING, name), "utf8");
    for (const match of source.matchAll(/["'](\/screenshots\/[^"']+)["']/g)) {
      found.push({ file: name, src: match[1] });
    }
  }
  return found;
}

describe("landing-page screenshots", () => {
  const referenced = referencedScreenshots();

  it("references at least the hero and the three tour screens", () => {
    // A guard on the guard: if the components stop referencing screenshots
    // entirely, every assertion below passes vacuously.
    expect(referenced.length).toBeGreaterThanOrEqual(4);
  });

  it("points every reference at a file that exists", () => {
    for (const { file, src } of referenced) {
      const onDisk = path.join(PUBLIC, src);
      expect(
        existsSync(onDisk),
        `${file} references ${src}, which is not in public/`,
      ).toBe(true);
    }
  });

  it("uses web-safe filenames", () => {
    /**
     * These arrived as "WhatsApp Image 2026-08-26 at 19.49.27 (1).jpeg".
     * Spaces and parentheses survive a local dev server and then need
     * percent-encoding everywhere else, which is the kind of thing that works
     * until it is deployed.
     */
    for (const name of readdirSync(path.join(PUBLIC, "screenshots"))) {
      expect(name, `${name} needs a web-safe name`).toMatch(
        /^[a-z0-9-]+\.(jpg|png|webp|avif)$/,
      );
    }
  });

  it("gives every screenshot a drawn fallback", () => {
    /**
     * `PhoneFrame` renders `fallback` when the file cannot be loaded. A usage
     * without one shows an empty frame instead — worse than the CSS mockup
     * this page shipped with, and worse than nothing.
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
