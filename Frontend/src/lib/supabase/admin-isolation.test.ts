import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The service-role key must never reach the browser.
 *
 * `lib/supabase/admin.ts` builds a client that bypasses RLS entirely — it can
 * read and write every tenant's data. Next decides what goes into the client
 * bundle by following imports from `"use client"` modules, so a single import
 * added in the wrong file is all it takes, and nothing about that mistake looks
 * wrong at the point it is written.
 *
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` would in fact be inlined as
 * `undefined` in a client bundle rather than leaking the value — the variable
 * has no `NEXT_PUBLIC_` prefix. That makes the failure quiet, not safe: the
 * feature would break in a way that invites someone to "fix" it by renaming the
 * variable, which is the step that does leak it. This test refuses the first
 * move.
 *
 * Source text rather than imports, for the same reason as the other coverage
 * suites: the property is syntactic, and these modules cannot be loaded in a
 * plain test environment anyway.
 */

const SRC = path.resolve(process.cwd(), "src");

/** Module specifier, src-relative and without the extension. */
const ADMIN_MODULE = "lib/supabase/admin";

/**
 * Resolves every import in a file and asks whether any of them *is* the admin
 * client — rather than pattern-matching the text `/admin`, which also hits the
 * unrelated `db/queries/admin.ts` and would make this suite cry wolf.
 */
function importsAdmin(rel: string, source: string): boolean {
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

  return specifiers.some((specifier) => {
    if (specifier.startsWith("@/")) return specifier.slice(2) === ADMIN_MODULE;
    if (!specifier.startsWith(".")) return false;
    const from = path.posix.dirname(rel);
    return (
      path.posix.normalize(path.posix.join(from, specifier)) === ADMIN_MODULE
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

describe("service-role client isolation", () => {
  it("finds client components at all", () => {
    // Without this, a change to how the directive is written would make the
    // suite pass by scanning nothing.
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it("no client component imports the service-role client", () => {
    const offenders = clientFiles
      .filter((f) => importsAdmin(f.rel, f.source))
      .map((f) => f.rel);

    // Named in the failure so the fix is obvious: move the call into a server
    // action and hand the client component its result.
    expect(offenders).toEqual([]);
  });

  it("only the upload action reaches for it", () => {
    // Not a rule against growth — it is a rule that growth is deliberate. Every
    // new caller has the whole database in its hands.
    const callers = files
      .filter((f) => importsAdmin(f.rel, f.source))
      .map((f) => f.rel)
      .sort();

    expect(callers).toEqual(["app/dashboard/media-actions.ts"]);
  });

  it("keeps the runtime guard that catches what this test cannot see", () => {
    const admin = files.find((f) => f.rel === "lib/supabase/admin.ts");
    expect(admin).toBeDefined();
    expect(admin!.source).toContain('typeof window !== "undefined"');
  });
});
