import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The analytics paywall must not ship the tenant's numbers.
 *
 * A CSS blur is a visual effect, not an access control: `filter: none` in
 * devtools reveals whatever was rendered behind it. The usual way this feature
 * is built wrong is to fetch the real figures and blur them, which is a paywall
 * anyone can lift in two clicks.
 *
 * So the properties below are structural, and checked as source text because
 * that is what they are — "does this component touch the database", "does the
 * page decide before it queries". Both modules pull in `"use server"` code and
 * cannot be imported into a plain test environment anyway.
 */

const read = (rel: string) =>
  readFileSync(path.resolve(process.cwd(), rel), "utf8");

const paywall = read("src/components/dashboard/analytics-paywall.tsx");
const page = read("src/app/dashboard/analytics/page.tsx");

describe("analytics paywall", () => {
  it("never reaches the database", () => {
    // No handle, no queries, nothing to leak.
    expect(paywall).not.toContain('from "@/db"');
    expect(paywall).not.toContain("@/db/queries");
  });

  it("takes no data from its caller", () => {
    // A props object is how real figures would find their way in later.
    expect(paywall).toMatch(/export function AnalyticsPaywall\(\)/);
  });

  it("says the numbers are a sample, in the UI and not only in a comment", () => {
    expect(paywall).toContain("הדגמה");
  });

  it("hides the sample from assistive tech and from the keyboard", () => {
    // A blurred link is still a focusable one, and a screen reader would read
    // invented figures as though they were the tenant's.
    expect(paywall).toContain("aria-hidden");
    expect(paywall).toContain("inert");
  });
});

describe("the analytics page", () => {
  it("checks the entitlement before it runs any query", () => {
    const gate = page.indexOf("advancedAnalytics");
    const firstQuery = page.indexOf("await Promise.all");

    expect(gate).toBeGreaterThan(-1);
    expect(firstQuery).toBeGreaterThan(-1);
    // Ordering, not merely presence: gating after the fetch would still put a
    // round trip of the tenant's data on the wire for a page they cannot see.
    expect(gate).toBeLessThan(firstQuery);
  });

  it("returns the paywall rather than falling through to the real panels", () => {
    expect(page).toContain("<AnalyticsPaywall />");
    expect(page).toMatch(
      /if \(!entitlementsFor\(business\)\.advancedAnalytics\)/,
    );
  });
});
