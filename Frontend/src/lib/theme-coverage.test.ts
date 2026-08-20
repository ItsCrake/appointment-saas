import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/lib/branding";

/**
 * The per-tenant accent, checked mechanically.
 *
 * Two failures this catches, both of which happened while it was being written:
 *
 * 1. **A client-facing page that forgets `data-accent`.** The CSS variables are
 *    scoped to that attribute, so a page without it resolves `bg-(--accent)` to
 *    nothing — a primary button rendered invisible. `/b/[token]` shipped that
 *    way the moment its button was themed.
 * 2. **A swatch missing a variable.** Six swatches × several variables is
 *    exactly the sort of table where one entry quietly goes missing, and the
 *    symptom is one business in six with a transparent banner.
 */

const APP = path.resolve(process.cwd(), "src/app");
const CSS = path.resolve(process.cwd(), "src/app/globals.css");

function pageFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pageFiles(full, acc);
    else if (/^page\.tsx$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const pages = pageFiles(APP).map((file) => ({
  rel: path.relative(APP, file).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

const css = readFileSync(CSS, "utf8");

/** The body of one `[data-accent="…"]` block. */
function swatchBlock(name: string): string {
  const start = css.indexOf(`[data-accent="${name}"] {`);
  if (start === -1) throw new Error(`no CSS block for accent "${name}"`);
  return css.slice(start, css.indexOf("}", start));
}

/**
 * Every `:root { … }` body joined together. There is more than one — the
 * background/foreground pair and the accent fallback live apart — and "is this
 * declared on :root at all" is the real question either way.
 */
function rootBlocks(): string {
  const blocks: string[] = [];
  let from = css.indexOf(":root {");
  while (from !== -1) {
    blocks.push(css.slice(from, css.indexOf("\n}", from)));
    from = css.indexOf(":root {", from + 1);
  }
  return blocks.join("\n");
}

describe("per-tenant accent coverage", () => {
  it("finds the pages at all", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it("every page rendering a booking component sets data-accent", () => {
    // The booking components are the ones that use `(--accent)`. A page that
    // renders one without the attribute is a page with invisible controls.
    const offenders = pages
      .filter((page) => page.source.includes("@/components/booking/"))
      .filter((page) => !page.source.includes("data-accent"))
      .map((page) => page.rel);

    expect(offenders).toEqual([]);
  });

  it("themes every client-facing route", () => {
    // Named explicitly as well, so deleting the import above cannot quietly
    // empty the check out.
    const themed = pages
      .filter((page) => page.source.includes("data-accent"))
      .map((page) => page.rel)
      .sort();

    expect(themed).toEqual([
      "[slug]/my-appointments/page.tsx",
      "[slug]/page.tsx",
      "b/[token]/page.tsx",
      /**
       * The one dashboard route in the list, and deliberately so.
       *
       * The dashboard chrome is monochrome by design, but the full calendar
       * tints its appointment blocks with the tenant's accent — the bookings on
       * it are the same objects the client sees on the branded page. Without the
       * attribute those blocks resolve the `:root` indigo fallback for every
       * shop, and today's column keeps its light soft tint in dark mode, since
       * the dark overrides are scoped to `[data-accent]`.
       */
      "dashboard/agenda/full/page.tsx",
      /**
       * The waitlist invite (0024). Client-facing and reached from a WhatsApp
       * message, so it carries the shop's colour for the same reason
       * `/b/[token]` does: somebody arriving from a message is still looking at
       * that business, and a page in a different colour reads as a different
       * company asking for their details.
       */
      "w/[token]/page.tsx",
    ]);
  });
});

describe("accent swatches", () => {
  /** Everything a swatch must define, beyond what the base block inherits. */
  const REQUIRED = [
    "--accent:",
    "--accent-strong:",
    "--accent-soft:",
    "--accent-soft-border:",
    "--accent-on-soft:",
    "--accent-mesh-base:",
    "--accent-mesh-a:",
    "--accent-mesh-b:",
  ];

  it.each(THEME_COLORS.filter((name) => name !== "indigo"))(
    "%s defines every variable exactly once",
    (name) => {
      const block = swatchBlock(name);
      for (const variable of REQUIRED) {
        expect(block.split(variable).length - 1).toBe(1);
      }
    },
  );

  it("indigo carries the defaults, including the contrast colour", () => {
    // Indigo shares its block with the bare `[data-accent]` fallback, which is
    // where `--accent-contrast` is declared for every swatch but amber.
    const start = css.indexOf('[data-accent="indigo"] {');
    const block = css.slice(start, css.indexOf("}", start));

    for (const variable of [...REQUIRED, "--accent-contrast:"]) {
      expect(block.split(variable).length - 1).toBe(1);
    }
  });

  it("keeps the mesh variables out of :root, where they would apply to every swatch", () => {
    // A leak here paints every business the same colour while looking correct
    // in one of them — which is what happened when these were first added.
    expect(rootBlocks()).not.toContain("--accent-mesh");
  });

  it("gives amber its own contrast colour, because white fails on it", () => {
    expect(swatchBlock("amber")).toContain("--accent-contrast:");
  });

  it("declares a fallback accent on :root so a missing attribute is not invisible", () => {
    expect(rootBlocks()).toContain("--accent:");
    expect(rootBlocks()).toContain("--accent-contrast:");
  });
});
