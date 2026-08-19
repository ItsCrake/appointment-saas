import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every route from the dashboard to a tenant's own public page carries
 * `?preview=1`.
 *
 * ---------------------------------------------------------------------------
 * **The bar is the only way back.** `/[slug]` is the client-facing page and has
 * no dashboard chrome of its own, so an owner who opens it from the dashboard
 * and lands without the preview bar is stranded on their own booking flow with
 * the browser's back button for company.
 *
 * This shipped exactly that way: the share link in settings asked for the bar
 * and the dashboard header did not, so whether an owner could get back depended
 * on which of two identical-looking links they had used. That is not a thing to
 * catch in review — the two links are in different files and neither looks
 * wrong on its own.
 *
 * The flag grants nothing. `/[slug]` resolves the session and checks ownership
 * before rendering the bar, so a client who guesses the parameter sees the
 * ordinary page.
 * ---------------------------------------------------------------------------
 */

const ROOTS = ["src/app/dashboard", "src/components/dashboard"];

/** `href={`/${slug}…`}` and `href={`/${business.slug}…`}`, with what follows. */
const TENANT_LINK = /href=\{`\/\$\{(?:business\.)?slug\}([^`]*)`\}/g;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const links = ROOTS.flatMap((root) => {
  const base = path.resolve(process.cwd(), root);
  return sourceFiles(base).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(TENANT_LINK)].map((match) => ({
      file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
      query: match[1],
    }));
  });
});

describe("links from the dashboard to a tenant's public page", () => {
  it("finds them at all", () => {
    // A rename that stopped these matching would otherwise make the check below
    // pass by inspecting nothing.
    expect(links.length).toBeGreaterThan(0);
  });

  it("every one asks for the preview bar", () => {
    const bare = links
      .filter((link) => !link.query.includes("preview=1"))
      .map((link) => `${link.file} → /\${slug}${link.query}`);

    expect(bare).toEqual([]);
  });
});
