import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two things about the booking page's shell that no unit test would
 * otherwise catch, and that nobody has ever looked at in a browser.
 *
 * ---------------------------------------------------------------------------
 * **Source assertions, deliberately.** Both of these are properties of markup
 * and CSS rather than of a function — there is no seam to call. Reading the
 * files is a blunt instrument, but the alternative here is no coverage at all
 * on a regression that already shipped once: the mount-scroll below was live
 * on the tenant page and looked like a layout bug rather than a decision.
 *
 * Each assertion targets the *mechanism*, not the formatting, so a rename
 * fails loudly and a reflow does not.
 * ---------------------------------------------------------------------------
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const FLOW = read("src/components/booking/booking-flow.tsx");
const CSS = read("src/app/globals.css");

describe("the page does not scroll itself on arrival", () => {
  it("guards the step effect against its own first run", () => {
    /**
     * `step` starts at 1, so an unguarded `useEffect(..., [step])` fires on
     * mount and scrolls a first-time visitor straight past the hero — the
     * logo, the banner, the name and the hours all gone before they saw them.
     * The guard is what keeps the initial viewport at the top.
     */
    expect(FLOW).toContain("hasNavigated");
    expect(FLOW).toMatch(/if \(!hasNavigated\.current\)/);
    expect(FLOW).toMatch(/hasNavigated\.current = true;\s*\n\s*return;/);
  });

  it("still moves on a real step change", () => {
    // The scroll is wanted when someone navigates — only arrival was wrong.
    expect(FLOW).toContain("scrollIntoView");
    expect(FLOW).toMatch(/\}, \[step\]\);/);
  });

  it("honours reduced motion for the programmatic scroll", () => {
    /**
     * `scroll-behavior: auto !important` in the stop-motion block does **not**
     * override a `scrollIntoView` that names `behavior: "smooth"` itself — the
     * argument wins. So the preference has to be read in JS as well.
     */
    expect(FLOW).toContain("prefers-reduced-motion: reduce");
    expect(FLOW).toMatch(/\?\s*"auto"\s*\n?\s*:\s*"smooth"/);
  });
});

describe("the ambient background", () => {
  it("declares the layer and all three blobs", () => {
    for (const cls of [
      ".ambient",
      ".ambient-blob",
      ".ambient-blob-a",
      ".ambient-blob-b",
      ".ambient-blob-c",
    ]) {
      expect(CSS).toContain(cls);
    }
  });

  it("draws every blob from the tenant's accent", () => {
    /**
     * The unified-theme guarantee. A literal colour anywhere in these
     * gradients would give every shop the same cloud, which is precisely what
     * the `data-accent` system exists to prevent.
     *
     * Scoped to the `.ambient-blob` rules themselves rather than "from here to
     * the end of the file", which is what it used to do — the landing page's
     * own `.hero-glow` also uses radial gradients and is *correctly* a literal
     * violet→blue, because that surface is the platform's rather than a
     * tenant's. Anything appended to the stylesheet used to be swept in here.
     */
    const rules = CSS.match(/\.ambient-blob[^{]*\{[^}]*\}/g) ?? [];
    const gradients = rules.flatMap(
      (rule) => rule.match(/radial-gradient\([^;]*\)/g) ?? [],
    );

    expect(gradients.length).toBeGreaterThan(0);
    for (const gradient of gradients) {
      expect(gradient).toContain("var(--accent");
    }
  });

  it("animates transforms only, never a repainting property", () => {
    /**
     * The performance contract, and the reason this is worth a test: the
     * obvious implementation animates `background-position` on one large
     * gradient, which repaints a full-viewport layer every frame on the
     * five-year-old phone this product is actually opened on. Transforms
     * composite on the GPU instead.
     */
    const frames =
      CSS.match(/@keyframes ambient-drift-[abc] \{[\s\S]*?\n\}/g) ?? [];

    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame).toContain("transform:");
      for (const banned of [
        "background-position",
        "background-size",
        "filter:",
        "width:",
        "height:",
        "opacity:",
      ]) {
        expect(frame).not.toContain(banned);
      }
    }
  });

  it("settles at rest under reduced motion rather than disappearing", () => {
    /**
     * The colour is the tenant's identity; only the movement was ever the
     * accessibility question. `animation: none` keeps the blobs painted.
     *
     * Found by the block that *mentions the blobs*, not by taking the last one
     * in the file — the stylesheet has several reduced-motion blocks, and
     * picking by position meant any rule appended later silently became the
     * thing under test.
     */
    const block = (
      CSS.match(/@media \(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g) ?? []
    ).find((candidate) => candidate.includes("ambient-blob"));

    expect(
      block,
      "no reduced-motion block covers the ambient blobs",
    ).toBeDefined();
    expect(block).toContain("animation: none");
    expect(block).not.toContain("display: none");
  });

  it("is stopped by the accessibility widget without naming it", () => {
    // `[data-a11y-still] *` already kills every animation with `!important`,
    // and the blobs are descendants of the root it stamps — so the widget
    // needs no rule of its own here, and must keep that blanket selector.
    expect(CSS).toMatch(/\[data-a11y-still\] \*/);
    expect(CSS).toMatch(/animation: none !important/);
  });
});
