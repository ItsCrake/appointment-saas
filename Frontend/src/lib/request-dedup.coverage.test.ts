import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The per-request dedup that keeps dashboard navigation quick.
 *
 * ---------------------------------------------------------------------------
 * `getCurrentUser()` is a **network round trip** to the Supabase auth server —
 * `getUser()` revalidates the session rather than trusting a spoofable cookie,
 * which is correct and stays. What was not correct is calling it twice to
 * answer one question: the dashboard layout's freeze check and the page's
 * `requireBusiness()` each made their own call, and each made its own identical
 * `getBusinessByOwner` query beside it.
 *
 * Every arrow click in the agenda, every day/week switch and every appointment
 * status button paid for both, because each one re-renders the whole route.
 *
 * React `cache` collapses them to one per render pass. Unwrapping either is a
 * silent regression — nothing breaks, the dashboard just gets slower again for
 * everyone — so it is checked mechanically rather than left to review.
 *
 * Source text rather than behaviour, matching `dashboard-session.coverage.test.ts`:
 * `cache` dedupes within a *request scope*, which a plain unit test does not
 * have, so asserting the wrapping is the honest thing this level can assert.
 * ---------------------------------------------------------------------------
 */

const read = (relative: string) =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("per-request dedup is in place", () => {
  it("imports cache from react where it is used", () => {
    for (const file of [
      "src/lib/supabase/server.ts",
      "src/lib/dashboard-session.ts",
    ]) {
      expect(read(file)).toMatch(/import \{ cache \} from "react"/);
    }
  });

  /**
   * The auth round trip. Two per render is two trips to Supabase before a
   * single appointment is read.
   */
  it("wraps getCurrentUser", () => {
    expect(read("src/lib/supabase/server.ts")).toMatch(
      /export const getCurrentUser = cache\(/,
    );
  });

  /** The duplicate business lookup the layout and the page both needed. */
  it("wraps the owner's business lookup", () => {
    expect(read("src/lib/dashboard-session.ts")).toMatch(
      /export const businessForOwner = cache\(/,
    );
  });

  /**
   * The layout must go through the shared helper. Calling `getBusinessByOwner`
   * directly there is precisely the duplicate this removed, and it would look
   * entirely reasonable in a diff.
   */
  it("has the dashboard layout share the page's lookup", () => {
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).toContain("businessForOwner");
    expect(layout).not.toContain("getBusinessByOwner");
  });
});
