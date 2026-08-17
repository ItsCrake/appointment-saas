import { describe, expect, it } from "vitest";

import {
  classifyPublicPath,
  isManageTokenShape,
  RESERVED_SEGMENTS,
} from "./public-slug";

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

  /**
   * WhatsApp's approved templates carry a URL button whose base was registered
   * with Meta as `https://www.bazman.app/` — without the `b/` — and Meta appends
   * only the varying tail to a base frozen at approval time. So every
   * confirmation and 24-hour reminder sends the client here.
   */
  describe("a bare cancel token belongs at /b/", () => {
    const TOKEN = "34e64171-cb3e-47b3-8548-82297eff1270";

    it("recognises a token at the root", () => {
      expect(classifyPublicPath(`/${TOKEN}`)).toEqual({
        kind: "manage-token",
        token: TOKEN,
      });
    });

    /**
     * The regression. A UUID is 36 lowercase hex characters and hyphens, so it
     * satisfies `SLUG_SHAPE` — without an explicit answer first, the proxy
     * looks it up as a shop, misses, and 404s the link a client was just sent.
     */
    it("would otherwise have been resolved as a shop", () => {
      expect(TOKEN).toMatch(/^[a-z0-9-]{1,40}$/);
    });

    it("leaves a near-miss to the database", () => {
      // One character short of a UUID: a real shop could be called this.
      const almost = TOKEN.slice(0, -1);
      expect(classifyPublicPath(`/${almost}`)).toEqual({
        kind: "tenant",
        slug: almost,
      });
    });

    it("does not claim an uppercase token", () => {
      // Tokens are written by `randomUUID()`, which is always lowercase.
      expect(classifyPublicPath(`/${TOKEN.toUpperCase()}`).kind).toBe(
        "impossible",
      );
    });

    it("does not claim a token carrying a sub-path", () => {
      expect(classifyPublicPath(`/${TOKEN}/my-appointments`).kind).toBe(
        "tenant",
      );
    });

    /**
     * The two halves of the same rule: whatever the router swallows, the forms
     * that let an owner choose an address must refuse, or a shop could save a
     * slug that silently resolves to somebody's cancellation page.
     */
    it("is the same shape the slug forms refuse", () => {
      expect(isManageTokenShape(TOKEN)).toBe(true);
      expect(isManageTokenShape(TOKEN.toUpperCase())).toBe(true);
      expect(isManageTokenShape(`  ${TOKEN}  `)).toBe(true);
      expect(isManageTokenShape("demo-barber")).toBe(false);
      expect(isManageTokenShape(TOKEN.slice(0, -1))).toBe(false);
    });
  });
});
