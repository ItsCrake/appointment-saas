import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  averageRating,
  isSafeMediaUrl,
  isThemeColor,
  parseGallery,
  parseReviews,
  THEME_COLORS,
  THEME_LABELS,
  toThemeColor,
  type Review,
} from "@/lib/branding";

const review = (overrides: Partial<Review> = {}): Review => ({
  id: "r1",
  clientName: "דנה",
  rating: 5,
  comment: "מעולה",
  date: "2026-08-01",
  ...overrides,
});

describe("theme colours", () => {
  it("accepts every listed colour and rejects anything else", () => {
    for (const colour of THEME_COLORS) expect(isThemeColor(colour)).toBe(true);

    expect(isThemeColor("puce")).toBe(false);
    expect(isThemeColor("")).toBe(false);
    expect(isThemeColor(null)).toBe(false);
    expect(isThemeColor(7)).toBe(false);
  });

  it("falls back to the default rather than throwing on a bad column", () => {
    expect(toThemeColor("emerald")).toBe("emerald");
    expect(toThemeColor("not-a-colour")).toBe("indigo");
    expect(toThemeColor(undefined)).toBe("indigo");
  });

  it("labels every colour", () => {
    for (const colour of THEME_COLORS) {
      expect(THEME_LABELS[colour]).toBeTruthy();
    }
  });

  /**
   * The names live in TypeScript, the colour values live in CSS. Nothing at
   * compile time connects them, so a colour added to one and not the other
   * would render an unstyled accent. This is the only thing that catches it.
   */
  it("has a stylesheet block for every listed colour", () => {
    const css = readFileSync(
      path.resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    for (const colour of THEME_COLORS) {
      expect(css).toContain(`[data-accent="${colour}"]`);
    }
  });
});

describe("isSafeMediaUrl", () => {
  it("allows http and https", () => {
    expect(isSafeMediaUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isSafeMediaUrl("http://example.com/a.png")).toBe(true);
  });

  it("rejects anything that could execute or inline a payload", () => {
    expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("data:text/html;base64,PHN2Zz4=")).toBe(false);
    expect(isSafeMediaUrl("not a url")).toBe(false);
    expect(isSafeMediaUrl("")).toBe(false);
  });
});

describe("parseGallery", () => {
  it("keeps only safe string URLs", () => {
    expect(
      parseGallery([
        "https://a.test/1.jpg",
        "javascript:alert(1)",
        42,
        null,
        "https://a.test/2.jpg",
      ]),
    ).toEqual(["https://a.test/1.jpg", "https://a.test/2.jpg"]);
  });

  it("survives a non-array column", () => {
    expect(parseGallery(null)).toEqual([]);
    expect(parseGallery("oops")).toEqual([]);
    expect(parseGallery({ 0: "https://a.test/1.jpg" })).toEqual([]);
  });
});

describe("parseReviews", () => {
  it("drops malformed entries and keeps valid ones", () => {
    const rows = parseReviews([
      review({ id: "ok" }),
      { id: "bad", clientName: "x" },
      review({ id: "rating-too-high", rating: 9 }),
      review({ id: "bad-date", date: "01/08/2026" }),
      review({ id: "ok2", rating: 3 }),
    ]);

    expect(rows.map((r) => r.id)).toEqual(["ok", "ok2"]);
  });

  it("survives a non-array column", () => {
    expect(parseReviews(undefined)).toEqual([]);
    expect(parseReviews("[]")).toEqual([]);
  });
});

describe("averageRating", () => {
  it("returns null with no reviews, so the UI can hide the block", () => {
    expect(averageRating([])).toBeNull();
  });

  it("rounds to one decimal", () => {
    expect(
      averageRating([
        review({ rating: 5 }),
        review({ rating: 4 }),
        review({ rating: 4 }),
      ]),
    ).toBe(4.3);

    expect(averageRating([review({ rating: 5 }), review({ rating: 4 })])).toBe(
      4.5,
    );
  });

  it("handles a single review", () => {
    expect(averageRating([review({ rating: 3 })])).toBe(3);
  });
});
