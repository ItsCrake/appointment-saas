import { describe, expect, it } from "vitest";

import { classifyPublicPath, RESERVED_SEGMENTS } from "./public-slug";

/**
 * The classifier decides, for every request that reaches the proxy, whether a
 * path is a tenant's booking page. Two failure directions, both bad:
 *
 * - too narrow → an unknown slug renders and answers a streamed 200, which is
 *   the soft 404 this whole guard exists to remove
 * - too broad → a real platform route is rewritten to a 404, which takes a
 *   working page offline
 *
 * So the tests below are mostly a census of the second kind.
 */

describe("classifyPublicPath", () => {
  it("treats a bare slug as a tenant page", () => {
    expect(classifyPublicPath("/demo-barber")).toEqual({
      kind: "tenant",
      slug: "demo-barber",
    });
  });

  it("treats the client's own appointments page as the same tenant", () => {
    expect(classifyPublicPath("/demo-barber/my-appointments")).toEqual({
      kind: "tenant",
      slug: "demo-barber",
    });
  });

  it("leaves the landing page alone", () => {
    expect(classifyPublicPath("/")).toEqual({ kind: "platform" });
  });

  it.each(RESERVED_SEGMENTS)("leaves /%s alone", (segment) => {
    expect(classifyPublicPath(`/${segment}`).kind).toBe("platform");
    expect(classifyPublicPath(`/${segment}/anything`).kind).toBe("platform");
  });

  it.each([
    "/sw.js",
    "/icon.svg",
    "/favicon.ico",
    "/apple-icon.png",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
  ])("leaves the file %s alone", (path) => {
    expect(classifyPublicPath(path).kind).toBe("platform");
  });

  it("leaves a path deeper than a booking page to Next's own 404", () => {
    // Three segments is not a route in this app at all, so Next already answers
    // it correctly. Claiming it here would mean owning a URL space we do not
    // serve, and would rewrite `/a/b/c` to a *business* not-found page.
    expect(classifyPublicPath("/demo-barber/a/b").kind).toBe("platform");
  });

  it("leaves an unknown sub-path under a real slug to Next's own 404", () => {
    expect(classifyPublicPath("/demo-barber/reviews").kind).toBe("platform");
  });

  describe("paths that cannot be a slug are 404 without a query", () => {
    // Every slug is lowercased through Zod before it reaches the column, so
    // none of these can match a row. Answering them from the character set
    // alone is what keeps bot noise off the database entirely.
    it.each([
      ["wrong case", "/Demo-Barber"],
      ["an underscore", "/wp_admin"],
      ["a percent escape", "/%2e%2e"],
      ["a tilde", "/~root"],
      ["Hebrew", "/מספרה"],
      ["longer than the column allows", `/${"a".repeat(41)}`],
    ])("%s", (_label, path) => {
      expect(classifyPublicPath(path).kind).toBe("impossible");
    });

    it("applies under a tenant sub-path too", () => {
      expect(classifyPublicPath("/Demo-Barber/my-appointments").kind).toBe(
        "impossible",
      );
    });
  });

  it("never classifies a slug-shaped path as a platform route", () => {
    // The guard's whole value is that `/wp-admin` and `/no-such-shop` stop
    // answering 200. Both are validly shaped, so both must reach the database.
    expect(classifyPublicPath("/wp-admin")).toEqual({
      kind: "tenant",
      slug: "wp-admin",
    });
    expect(classifyPublicPath("/no-such-business-at-all")).toEqual({
      kind: "tenant",
      slug: "no-such-business-at-all",
    });
  });

  it("ignores a path that is not a path", () => {
    expect(classifyPublicPath("https://evil.example/demo").kind).toBe(
      "platform",
    );
  });
});
