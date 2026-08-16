import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Anthropic API key must never reach the browser.
 *
 * Same shape and same reasoning as `lib/supabase/admin-isolation.test.ts`, for
 * a different secret. `lib/voice/libi.ts` reads `ANTHROPIC_API_KEY`, which has
 * no `NEXT_PUBLIC_` prefix — so an import from a `"use client"` module would
 * inline `undefined` rather than leak the value. That makes the failure quiet,
 * not safe: Libi would stop working for no visible reason, and the obvious
 * "fix" is to rename the variable with the prefix, which publishes a billable
 * key to every visitor.
 *
 * A leaked model key is worse than an inert one, too. It is not merely readable
 * — it is *spendable*, by anyone, against this account, until it is noticed.
 *
 * Source text rather than resolved imports, like every other coverage suite
 * here: the property is syntactic, and the modules cannot be loaded in a plain
 * test environment anyway.
 */

const SRC = path.resolve(process.cwd(), "src");

const LIBI_MODULE = "lib/voice/libi";

/**
 * Resolves each import and asks whether it *is* the model module — rather than
 * matching the text "libi", which would also hit `libi-schema` (pure, safe, and
 * imported by the client component on purpose) and make this suite cry wolf.
 */
function importsLibi(rel: string, source: string): boolean {
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

  return specifiers.some((specifier) => {
    if (specifier.startsWith("@/")) return specifier.slice(2) === LIBI_MODULE;
    if (!specifier.startsWith(".")) return false;
    const from = path.posix.dirname(rel);
    return (
      path.posix.normalize(path.posix.join(from, specifier)) === LIBI_MODULE
    );
  });
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).replace(/\\/g, "/"),
  source: readFileSync(file, "utf8"),
}));

const clientFiles = files.filter((f) => /^["']use client["']/m.test(f.source));

describe("voice assistant key isolation", () => {
  it("finds client components at all", () => {
    // Without this, a change to how the directive is written would let the
    // suite pass by scanning nothing.
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it("no client component imports the model module", () => {
    const offenders = clientFiles
      .filter((f) => importsLibi(f.rel, f.source))
      .map((f) => f.rel);

    // Named in the failure so the fix is obvious: call it from the server
    // action and hand the client component the result.
    expect(offenders).toEqual([]);
  });

  it("only the voice action and the dashboard page reach for it", () => {
    // Not a rule against growth — a rule that growth is deliberate. Every new
    // caller spends money per invocation on the tenant's behalf.
    const callers = files
      .filter((f) => importsLibi(f.rel, f.source))
      .map((f) => f.rel)
      .sort();

    expect(callers).toEqual([
      "app/dashboard/page.tsx",
      "app/dashboard/voice-actions.ts",
    ]);
  });

  it("keeps the runtime guard that catches what this test cannot see", () => {
    // A dynamic import or a re-export chain would slip past the syntactic scan
    // above; the throw is what stops it becoming a silent bundle.
    const libi = files.find((f) => f.rel === "lib/voice/libi.ts");
    expect(libi).toBeDefined();
    expect(libi!.source).toContain('typeof window !== "undefined"');
  });

  it("keeps the pure schema importable from the browser", () => {
    // The client component needs the draft types and the merge rule. That file
    // must therefore stay free of the SDK and of any key read — this is the
    // assertion that keeps the split honest rather than incidental.
    const schema = files.find((f) => f.rel === "lib/voice/libi-schema.ts");
    expect(schema).toBeDefined();
    expect(schema!.source).not.toContain("ANTHROPIC_API_KEY");
    expect(schema!.source).not.toContain("@anthropic-ai/sdk");
  });
});
