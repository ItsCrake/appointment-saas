import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every dashboard page must be reachable on a phone.
 *
 * This exists because it was not. The bottom bar renders `LINKS.slice(0, 4)`
 * and the sidebar that holds the rest is `md:block`, so adding
 * `/dashboard/staff` made it reachable on a desktop and **invisible on a
 * phone** — with nothing in the type system, the build or the suite to notice.
 * A business owner running the shop from their pocket simply could not get to
 * it.
 *
 * Read as source text rather than imported: `dashboard-nav.tsx` pulls in a
 * `"use server"` module, which cannot be loaded in a plain test environment.
 * The property being checked is syntactic anyway — "is this route in the nav
 * array" — which is exactly what a reviewer scans for and eventually misses.
 */

const DASHBOARD_DIR = path.resolve(process.cwd(), "src/app/dashboard");
const NAV_FILE = path.resolve(
  process.cwd(),
  "src/components/dashboard/dashboard-nav.tsx",
);

/**
 * Routes deliberately absent from the navigation, each with its reason.
 * **Adding a name here is the deliberate act** — the point is that a page
 * cannot become unreachable by omission.
 */
const NOT_IN_NAV: Record<string, string> = {
  // Onboarding. The nav is replaced by a sign-out affordance while it runs,
  // because every other section redirects back into it.
  setup: "onboarding, which renders its own chrome",
};

/** Directories under /dashboard that actually render a page. */
function routeSegments(): string[] {
  return readdirSync(DASHBOARD_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) =>
      readdirSync(path.join(DASHBOARD_DIR, entry.name)).some((f) =>
        /^page\.tsx?$/.test(f),
      ),
    )
    .map((entry) => entry.name);
}

const source = readFileSync(NAV_FILE, "utf8");

/** The hrefs listed in the nav's `LINKS` array, in order. */
function navHrefs(): string[] {
  const block = source.match(/const LINKS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("LINKS array not found in dashboard-nav.tsx");
  return [...block[1].matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("mobile navigation coverage", () => {
  const hrefs = navHrefs();

  it("finds the nav array at all", () => {
    // A refactor that renames or restructures it would otherwise make this
    // suite pass by checking nothing.
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    expect(hrefs).toContain("/dashboard");
  });

  it("lists every dashboard page in the nav", () => {
    const missing = routeSegments()
      .filter((segment) => !(segment in NOT_IN_NAV))
      .filter((segment) => !hrefs.includes(`/dashboard/${segment}`));

    // Named in the failure so the fix is obvious: add it to LINKS, or add it
    // to NOT_IN_NAV with a reason.
    expect(missing).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const segments = routeSegments();
    const stale = Object.keys(NOT_IN_NAV).filter((s) => !segments.includes(s));
    expect(stale).toEqual([]);
  });

  it("splits the overflow off the same array rather than repeating it", () => {
    // If SECONDARY_LINKS were ever written out by hand it could drift from
    // MOBILE_LINKS, and a link could land in both places or in neither — which
    // is the original bug wearing a different hat.
    expect(source).toContain("const MOBILE_LINKS = LINKS.slice(0, 4)");
    expect(source).toContain(
      "const SECONDARY_LINKS = LINKS.slice(MOBILE_LINKS.length)",
    );
  });

  it("renders the overflow behind a control that is visible on mobile", () => {
    // The sidebar holding the rest is `md:block`. The sheet must therefore live
    // in a container that is *not* hidden below `md`, or the overflow is as
    // unreachable as it was before.
    const mobileBar = source.match(
      /<div className="[^"]*md:hidden[^"]*">\s*<MoreSheet/,
    );
    expect(mobileBar).not.toBeNull();
  });
});
