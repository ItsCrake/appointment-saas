import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RESERVED_SEGMENTS } from "./public-slug";

/**
 * Every top-level route must be declared as a platform route, or the proxy will
 * 404 it.
 *
 * `/[slug]` is a root-level dynamic segment, so adding `src/app/pricing/` gives
 * the platform a `/pricing` page **and** makes it indistinguishable from a
 * tenant called "pricing". The proxy would look the slug up, not find it, and
 * rewrite a working page to a 404 — in production only, since the local
 * database might well have no businesses at all, and with nothing in the type
 * system or the build to say so.
 *
 * The matcher in `proxy.ts` cannot carry this list itself: Next requires
 * matcher patterns to be statically analysable literals. So the list lives in
 * code and this test is what keeps it honest.
 *
 * Same shape as `nav-coverage.test.ts` and `dashboard-session.coverage.test.ts`
 * — a route cannot break by omission, only by a deliberate entry.
 */

const APP_DIR = path.resolve(process.cwd(), "src/app");

/**
 * Top-level directories that are not routes and therefore need no entry.
 * Adding a name here is the deliberate act.
 */
const NOT_A_ROUTE: Record<string, string> = {
  "[slug]": "the tenant segment itself — the thing being protected",
};

/** Top-level directories under `src/app` that actually render something. */
function topLevelRoutes(): string[] {
  return (
    readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      // Route groups `(x)` and private folders `_x` do not appear in the URL.
      .filter((entry) => !/^[(_]/.test(entry.name))
      .filter((entry) =>
        readdirSync(path.join(APP_DIR, entry.name)).some((file) =>
          /^(page|route)\.tsx?$/.test(file),
        ),
      )
      .map((entry) => entry.name)
  );
}

describe("public slug reserved segments", () => {
  it("finds the app directory at all", () => {
    // Otherwise a moved folder would make this suite pass by checking nothing.
    expect(topLevelRoutes().length).toBeGreaterThanOrEqual(5);
  });

  it("reserves every top-level route", () => {
    const missing = topLevelRoutes()
      .filter((segment) => !(segment in NOT_A_ROUTE))
      .filter((segment) => !RESERVED_SEGMENTS.includes(segment));

    // Named in the failure so the fix is obvious: add it to RESERVED_SEGMENTS,
    // or to NOT_A_ROUTE with a reason.
    expect(missing).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const dirs = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const stale = Object.keys(NOT_A_ROUTE).filter((s) => !dirs.includes(s));
    expect(stale).toEqual([]);
  });

  it("reserves nothing that no longer exists", () => {
    // A stale reservation is not dangerous, but it does permanently deny that
    // slug to every tenant, which an owner would experience as "this name is
    // taken" with no shop behind it.
    const dirs = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const stale = RESERVED_SEGMENTS.filter((s) => !dirs.includes(s));
    expect(stale).toEqual([]);
  });
});
