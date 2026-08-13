import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The one bug class this suite structurally **cannot** catch, made mechanical.
 *
 * A bare `sql` fragment has no declared column type, so postgres.js hands back
 * the raw string Postgres sent while the TypeScript annotation claims `Date` or
 * `number`. PGlite parses the same value, so a test asserting on it proves the
 * opposite of production — which is exactly how a `max()` aggregate annotated
 * `Date | null` took `/master/alerts` down with a `RangeError`. See
 * `sql-types.ts` and ARCHITECTURE.md § Testing.
 *
 * Every call site is correct today. Nothing stopped the next one being wrong,
 * and the next one would pass every test and fail only in production — so this
 * is a *syntactic* check, in the same mould as `nav-coverage`,
 * `public-slug.coverage`, `dashboard-session.coverage` and `admin-isolation`:
 * the property cannot break by omission, only by a deliberate entry below.
 *
 * Two rules, both about the same lie — an annotation the driver does not honour:
 *
 * 1. **A selection annotated `Date` must pass through `toDate` in the same
 *    file.** This is the failure that already happened.
 * 2. **A selection annotated `number` must carry a cast to a type postgres.js
 *    returns as a number.** `count(*)` is `int8`, and postgres.js returns
 *    `int8` and `numeric` as **strings** to avoid silently losing precision —
 *    so an uncast `count(*)` annotated `number` gives `"51"`, and `+ 1` gives
 *    `"511"`. Every count in this repo is already written `::int`; this is what
 *    keeps that a rule rather than a habit.
 *
 * Test files are not scanned. They run against PGlite by definition, so they
 * are not a production read path — and their fixtures legitimately write raw
 * SQL that no consumer ever reads back through an annotation.
 */

const SRC_DIR = path.resolve(process.cwd(), "src");

/**
 * `sql<Annotation>` followed by its template literal, capturing the object key
 * it is assigned to when there is one. Only a keyed selection is read back by a
 * caller — a bare `sql<…>` in an `orderBy` or a `where` returns no value.
 */
const SQL_SELECTION = /(?:(\w+)\s*:\s*)?\bsql<([^>]*)>\s*`((?:[^`\\]|\\.)*)`/g;

/**
 * Casts postgres.js decodes into a JS `number`.
 *
 * `int8` and `numeric` are deliberately absent: the driver returns both as
 * strings, so casting to one is not a fix for a `number` annotation.
 */
const NUMERIC_CAST =
  /::\s*(?:integer|smallint|int4|int2|int|float8|float4|real|double\s+precision)\b/i;

/**
 * Selections allowed to skip a rule, each with the reason. **Adding a key here
 * is the deliberate act** — the whole point is that it cannot happen by
 * omission. Keyed `<repo-relative file>:<selection key>`.
 */
const EXEMPT: Record<string, string> = {};

type Selection = {
  file: string;
  key: string;
  annotation: string;
  body: string;
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** Every keyed `sql<…>` selection in the tree, with the file that holds it. */
function selections(): { all: Selection[]; byFile: Map<string, string> } {
  const all: Selection[] = [];
  const byFile = new Map<string, string>();

  for (const file of sourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    const rel = path.relative(SRC_DIR, file).replace(/\\/g, "/");
    byFile.set(rel, source);

    for (const match of source.matchAll(SQL_SELECTION)) {
      const [, key, annotation, body] = match;
      if (!key) continue;
      all.push({ file: rel, key, annotation, body });
    }
  }

  return { all, byFile };
}

const { all, byFile } = selections();

const id = (s: Selection) => `${s.file}:${s.key}`;

describe("raw sql selections are coerced at the boundary", () => {
  it("finds the query layer at all", () => {
    // Otherwise a moved directory or a broken pattern would let this suite pass
    // by checking nothing at all, which is the failure mode of every mechanical
    // coverage test.
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all.some((s) => s.file.startsWith("db/queries/"))).toBe(true);
  });

  it("passes every Date-annotated selection through toDate", () => {
    const unconverted = all
      .filter((s) => /\bDate\b/.test(s.annotation))
      .filter((s) => !(id(s) in EXEMPT))
      .filter((s) => {
        const source = byFile.get(s.file) ?? "";
        // `toDate(row.lastVisit)` — the key must be named inside a toDate call
        // somewhere in the file that selected it.
        return !new RegExp(String.raw`toDate\s*\([^)]*\b${s.key}\b`).test(
          source,
        );
      })
      .map(id);

    // Named in the failure so the fix is obvious: convert it where the rows are
    // returned. `.mapWith()` does not work in this position — see `sql-types.ts`.
    expect(unconverted).toEqual([]);
  });

  it("casts every number-annotated selection to a type the driver decodes", () => {
    const uncast = all
      .filter((s) => /\bnumber\b/.test(s.annotation))
      .filter((s) => !(id(s) in EXEMPT))
      .filter((s) => !NUMERIC_CAST.test(s.body))
      .map(id);

    // The fix is `::int` on the expression. `count(*)` alone is int8, which
    // postgres.js returns as a string while the annotation says number.
    expect(uncast).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const live = new Set(all.map(id));
    const stale = Object.keys(EXEMPT).filter((key) => !live.has(key));

    // A stale exemption is a hole nobody is watching: the selection it excused
    // is gone, so the entry now only serves to excuse the next one to take its
    // name.
    expect(stale).toEqual([]);
  });
});
