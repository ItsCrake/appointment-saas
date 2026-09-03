import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ליבי's API key must never reach the browser.
 *
 * ---------------------------------------------------------------------------
 * Same shape and same reasoning as `lib/supabase/admin-isolation.test.ts`, for
 * a different secret. `OPENAI_API_KEY` has no `NEXT_PUBLIC_` prefix — so an
 * import from a `"use client"` module would inline `undefined` rather than leak
 * the value. That makes the failure quiet, not safe: ליבי would stop working
 * for no visible reason, and the obvious "fix" is to rename the variable with
 * the prefix, which publishes a billable key to every visitor.
 *
 * A leaked model key is worse than an inert one, too. It is not merely readable
 * — it is *spendable*, by anyone, against this account, until it is noticed.
 *
 * Source text rather than resolved imports, like every other coverage suite
 * here: the property is syntactic, and the modules cannot be loaded in a plain
 * test environment anyway.
 * ---------------------------------------------------------------------------
 */

const SRC = path.resolve(process.cwd(), "src");

/**
 * Every module that reads the key.
 *
 * One provider now. The Anthropic half went with the legacy assistant, and this
 * list is what makes adding a second one a deliberate act rather than something
 * noticed on a bill.
 */
const KEY_BEARING_MODULES = [
  "lib/voice/libi-config",
  "lib/voice/libi-voice",
] as const;

/**
 * Resolves each import and asks whether it *is* the named module — rather than
 * matching the text "libi", which would also hit `libi-speech` (pure, safe, and
 * fine to import anywhere) and make this suite cry wolf.
 */
function importsModule(rel: string, source: string, target: string): boolean {
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

  return specifiers.some((specifier) => {
    if (specifier.startsWith("@/")) return specifier.slice(2) === target;
    if (!specifier.startsWith(".")) return false;
    const from = path.posix.dirname(rel);
    return path.posix.normalize(path.posix.join(from, specifier)) === target;
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

describe("ליבי key isolation", () => {
  it("finds client components at all", () => {
    // Without this, a change to how the directive is written would let the
    // suite pass by scanning nothing.
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it.each(KEY_BEARING_MODULES)("no client component imports %s", (target) => {
    const offenders = clientFiles
      .filter((f) => importsModule(f.rel, f.source, target))
      .map((f) => f.rel);

    // Named in the failure so the fix is obvious: call it from the route and
    // hand the client component the result.
    expect(offenders).toEqual([]);
  });

  it("keeps the reach for the key deliberately small", () => {
    /**
     * Not a rule against growth — a rule that growth is deliberate. Every new
     * caller spends money per invocation on the tenant's behalf, and the
     * dashboard layout is here only to decide whether to render the microphone.
     */
    const callers = files
      .filter((f) =>
        KEY_BEARING_MODULES.some((m) => importsModule(f.rel, f.source, m)),
      )
      .map((f) => f.rel)
      .sort();

    expect(callers).toEqual([
      "app/api/voice/process/route.ts",
      "app/dashboard/layout.tsx",
      "lib/voice/libi-voice.ts",
    ]);
  });

  it.each(["lib/voice/libi-config.ts", "lib/voice/libi-voice.ts"])(
    "%s keeps the runtime guard",
    (rel) => {
      // A dynamic import or a re-export chain would slip past the syntactic
      // scan above; the throw is what stops it becoming a silent bundle.
      const found = files.find((f) => f.rel === rel);
      expect(found).toBeDefined();
      expect(found!.source).toMatch(
        /typeof window !== "undefined"|assertVoiceServer/,
      );
    },
  );

  it("keeps the tools and the speech free of any key", () => {
    /**
     * `libi-tools` talks to the database and `libi-speech` is pure text. Both
     * must stay that way: they are the modules a future contributor is most
     * likely to import somewhere convenient, and neither has any business
     * reading a secret.
     */
    for (const rel of ["lib/voice/libi-tools.ts", "lib/voice/libi-speech.ts"]) {
      const found = files.find((f) => f.rel === rel);
      expect(found, rel).toBeDefined();
      expect(found!.source).not.toContain("OPENAI_API_KEY");
      expect(found!.source).not.toContain("ANTHROPIC_API_KEY");
    }
  });

  it("has no trace of the retired assistant left", () => {
    // The Anthropic-era implementation is gone. A dangling import of it would
    // be a build error; a dangling *reference* in prose is how a reader is sent
    // looking for a file that does not exist.
    const stale = files
      .filter((f) => /voice\/libi["']|voice\/libi-schema|LibiButton/.test(f.source))
      .map((f) => f.rel);

    expect(stale).toEqual([]);
  });
});
