import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CARD_STYLES,
  CARD_STYLE_HINTS,
  CARD_STYLE_LABELS,
  CORNER_STYLES,
  CORNER_STYLE_LABELS,
  DEFAULT_CARD_STYLE,
  DEFAULT_CORNER_STYLE,
  DEFAULT_HERO_OVERLAY,
  DEFAULT_SERVICE_LAYOUT,
  HERO_OVERLAY_MAX,
  HERO_OVERLAY_MIN,
  resolveServiceLayout,
  SERVICE_LAYOUTS,
  SERVICE_LAYOUT_LABELS,
  toAppearance,
  toCardStyle,
  toCornerStyle,
  toHeroOverlay,
  toServiceLayout,
} from "@/lib/appearance";

/**
 * The booking page's dressing (0027).
 *
 * Two things are worth a test here and the rest is bookkeeping. **Every
 * coercion has to be total**, because these columns are `text` and a value
 * written by a seed, a migration or psql must still render a page. And **the
 * option lists have to agree with the stylesheet**, because this module owns
 * the names while `globals.css` owns what they look like — the same split
 * `branding.ts` uses, and the same way it can silently drift.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("the stylesheet and this module agree", () => {
  it("defines every card style as a [data-card] block", () => {
    // A name with no block renders an unstyled card rather than failing, which
    // is exactly the kind of drift nothing else would catch.
    for (const style of CARD_STYLES) {
      expect(CSS).toContain(`[data-card="${style}"]`);
    }
  });

  it("defines every corner style as a [data-corner] block", () => {
    for (const corner of CORNER_STYLES) {
      expect(CSS).toContain(`[data-corner="${corner}"]`);
    }
  });

  it("ships the bare-attribute fallbacks the defaults rely on", () => {
    /**
     * `[data-card]` and `[data-corner]` on their own fire only when the
     * attribute is *present*, and they carry the values every card had before
     * 0027. Without them a page that sets the attribute to the default name
     * would resolve every token to nothing.
     */
    expect(CSS).toMatch(/\[data-card\],\s*\n\s*\[data-card="elevated"\]/);
    expect(CSS).toMatch(/\[data-corner\],\s*\n\s*\[data-corner="rounded"\]/);
  });

  it("declares the classes the components apply", () => {
    for (const cls of [
      ".booking-card",
      ".booking-wash",
      ".hero-scrim",
      ".step-pill",
    ]) {
      expect(CSS).toContain(cls);
    }
  });

  it("labels every option in Hebrew", () => {
    for (const style of CARD_STYLES) {
      expect(CARD_STYLE_LABELS[style].trim()).not.toBe("");
      expect(CARD_STYLE_HINTS[style].trim()).not.toBe("");
    }
    for (const corner of CORNER_STYLES) {
      expect(CORNER_STYLE_LABELS[corner].trim()).not.toBe("");
    }
    for (const layout of SERVICE_LAYOUTS) {
      expect(SERVICE_LAYOUT_LABELS[layout].trim()).not.toBe("");
    }
  });
});

describe("coercion is total", () => {
  it("accepts every legal name", () => {
    for (const style of CARD_STYLES) expect(toCardStyle(style)).toBe(style);
    for (const c of CORNER_STYLES) expect(toCornerStyle(c)).toBe(c);
    for (const l of SERVICE_LAYOUTS) expect(toServiceLayout(l)).toBe(l);
  });

  it("falls back rather than throwing on anything else", () => {
    // The columns are text so retiring an option is a code change and never a
    // migration — which only works if a retired name still renders.
    for (const junk of [null, undefined, 42, {}, "", "retired-style"]) {
      expect(toCardStyle(junk)).toBe(DEFAULT_CARD_STYLE);
      expect(toCornerStyle(junk)).toBe(DEFAULT_CORNER_STYLE);
      expect(toServiceLayout(junk)).toBe(DEFAULT_SERVICE_LAYOUT);
    }
  });

  it("clamps the overlay into its legal range", () => {
    expect(toHeroOverlay(0)).toBe(HERO_OVERLAY_MIN);
    expect(toHeroOverlay(90)).toBe(HERO_OVERLAY_MAX);
    // Above the cap, not at it: 100 would be a black rectangle where a hero
    // used to be, and a range whose extreme deletes its subject is a trap.
    expect(toHeroOverlay(100)).toBe(HERO_OVERLAY_MAX);
    expect(toHeroOverlay(-20)).toBe(HERO_OVERLAY_MIN);
    expect(toHeroOverlay(47.6)).toBe(48);
    expect(toHeroOverlay("60")).toBe(60);
  });

  it("reads a missing or unparseable overlay as the default", () => {
    for (const junk of [null, undefined, "abc", {}, NaN]) {
      expect(toHeroOverlay(junk)).toBe(DEFAULT_HERO_OVERLAY);
    }
  });

  it("resolves a whole row at once", () => {
    expect(
      toAppearance({
        cardStyle: "glass",
        cornerStyle: "nonsense",
        serviceLayout: "showcase",
        heroOverlay: 1000,
      }),
    ).toEqual({
      cardStyle: "glass",
      cornerStyle: DEFAULT_CORNER_STYLE,
      serviceLayout: "showcase",
      heroOverlay: HERO_OVERLAY_MAX,
    });
  });
});

describe("resolveServiceLayout", () => {
  it("keeps showcase when at least one service has a picture", () => {
    expect(
      resolveServiceLayout("showcase", [
        { imageUrl: null },
        { imageUrl: "https://example.com/a.jpg" },
      ]),
    ).toBe("showcase");
  });

  it("degrades to compact when nothing has a picture", () => {
    /**
     * A column of empty frames is worse than the list it replaced, and an
     * owner who chose "תמונות" and uploaded nothing has not asked for that.
     * The *setting* is untouched, so the first upload turns it on by itself.
     */
    expect(resolveServiceLayout("showcase", [{ imageUrl: null }, {}])).toBe(
      "compact",
    );

    expect(resolveServiceLayout("showcase", [])).toBe("compact");
  });

  it("never promotes compact into showcase", () => {
    // The degrade runs one way only: pictures existing is not a reason to
    // override an owner who asked for the faster read.
    expect(
      resolveServiceLayout("compact", [
        { imageUrl: "https://example.com/a.jpg" },
      ]),
    ).toBe("compact");
  });
});
