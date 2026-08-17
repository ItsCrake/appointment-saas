import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

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

  it("runs on a bare cancel token", () => {
    // The WhatsApp button lands here. If the matcher stopped covering it the
    // redirect below would never run, and the failure would look like a 404 on
    // a link that was sent to a real client.
    expect(matches("/34e64171-cb3e-47b3-8548-82297eff1270")).toBe(true);
  });
});

/**
 * The other half of the approved button's contract.
 *
 * Meta froze the base URL as `https://www.bazman.app/` — no `b/` — at approval
 * time and appends only the cancel token, so this redirect is what makes every
 * confirmation and 24-hour reminder link resolve.
 */
describe("a bare cancel token redirects to the page that serves it", () => {
  const TOKEN = "34e64171-cb3e-47b3-8548-82297eff1270";

  const request = (path: string) =>
    new NextRequest(new URL(path, "https://www.bazman.app"));

  it("sends it to /b/<token>", async () => {
    const response = await proxy(request(`/${TOKEN}`));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `https://www.bazman.app/b/${TOKEN}`,
    );
  });

  /**
   * Redirected rather than rewritten, and this is the reason.
   *
   * `next.config.ts` attaches `noindex, nofollow` and `private, no-store` by
   * matching the request path against `/b/:path*`. A rewrite keeps the visitor
   * on `/<token>`, where neither header matches — putting a client's name, time
   * and live cancellation control at a cacheable, indexable URL.
   */
  it("moves the visitor rather than rewriting under them", async () => {
    const response = await proxy(request(`/${TOKEN}`));

    // A rewrite answers 200 and carries x-middleware-rewrite instead.
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.status).toBeGreaterThanOrEqual(300);
  });
});
