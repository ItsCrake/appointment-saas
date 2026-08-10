import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config } from "./proxy";

/**
 * The matcher decides whether the proxy runs at all, and a matcher that stops
 * covering a path fails **silently**: the 404 guard simply does not happen, the
 * page renders, and the only symptom is the streamed 200 that was there before.
 * Nothing else in the build would notice.
 *
 * `config` is imported rather than transcribed, so this asserts the real
 * pattern. Note that the module-level `RESERVED_SEGMENTS` list is what excludes
 * platform routes — the matcher deliberately still *matches* them, because Next
 * requires matcher patterns to be static literals and a second copy of that
 * list would drift. See `public-slug.coverage.test.ts`.
 */

const matches = (url: string) =>
  unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });

describe("proxy matcher", () => {
  it.each([
    "/demo-barber",
    "/demo-barber/my-appointments",
    "/no-such-business-at-all",
    "/dashboard",
    "/dashboard/settings",
    "/login",
  ])("runs on %s", (url) => {
    expect(matches(url)).toBe(true);
  });

  it("skips the landing page", () => {
    // The highest-traffic route in the product, and there is nothing here for
    // it — `/` is a static prerender with no slug to resolve. This is why the
    // pattern ends in `.+` rather than `.*`.
    expect(matches("/")).toBe(false);
  });

  it.each([
    "/_next/static/chunk.js",
    "/_next/image",
    "/api/cron/notifications",
  ])("skips the framework path %s", (url) => {
    expect(matches(url)).toBe(false);
  });

  it.each([
    "/sw.js",
    "/icon.svg",
    "/favicon.ico",
    "/apple-icon.png",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
  ])("skips the file %s", (url) => {
    // Every one of these is a real request on a real booking page load. Paying
    // a function invocation to decide they are not a shop would be pure waste.
    expect(matches(url)).toBe(false);
  });
});
