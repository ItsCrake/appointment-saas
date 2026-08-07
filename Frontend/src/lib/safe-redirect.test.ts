import { describe, expect, it } from "vitest";

import { isSafeRedirectPath, safeRedirectPath } from "@/lib/safe-redirect";

describe("isSafeRedirectPath", () => {
  it("accepts ordinary in-app paths, with query and hash", () => {
    expect(isSafeRedirectPath("/login/reset")).toBe(true);
    expect(isSafeRedirectPath("/dashboard/setup?plan=pro")).toBe(true);
    expect(isSafeRedirectPath("/dashboard#today")).toBe(true);
  });

  it("rejects an absolute URL to another origin", () => {
    expect(isSafeRedirectPath("https://evil.example/steal")).toBe(false);
    expect(isSafeRedirectPath("http://evil.example")).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    // `//evil.example` is not a path — a browser reads it as another origin,
    // which is exactly the trick this guard exists for.
    expect(isSafeRedirectPath("//evil.example")).toBe(false);
    expect(isSafeRedirectPath("//evil.example/reset")).toBe(false);
  });

  it("rejects backslashes, which some browsers normalise into the authority", () => {
    expect(isSafeRedirectPath("/\\evil.example")).toBe(false);
    expect(isSafeRedirectPath("/\\/evil.example")).toBe(false);
  });

  it("rejects control characters that could forge a Location header", () => {
    expect(isSafeRedirectPath("/ok\r\nSet-Cookie: a=b")).toBe(false);
    expect(isSafeRedirectPath("/ok\nX: y")).toBe(false);
    expect(isSafeRedirectPath("/ok\ttab")).toBe(false);
    // The same path without them is fine, so the guard is not simply
    // rejecting everything it is handed.
    expect(isSafeRedirectPath("/ok")).toBe(true);
  });

  it("rejects a bare relative path", () => {
    // Without a leading slash the browser resolves against the current
    // directory, which is not a destination this app ever means.
    expect(isSafeRedirectPath("dashboard")).toBe(false);
    expect(isSafeRedirectPath("")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("falls back when the value is missing or unsafe", () => {
    expect(safeRedirectPath(null, "/login/reset")).toBe("/login/reset");
    expect(safeRedirectPath(undefined, "/login/reset")).toBe("/login/reset");
    expect(safeRedirectPath("https://evil.example", "/login/reset")).toBe(
      "/login/reset",
    );
  });

  it("returns a safe value unchanged", () => {
    expect(safeRedirectPath("/login/reset", "/dashboard")).toBe("/login/reset");
  });

  it("honours a prefix when the caller knows where the journey ends", () => {
    // Sign-in only ever returns someone to the dashboard, so an in-app path
    // outside it is still not what that redirect is for.
    expect(
      safeRedirectPath("/dashboard/hours", "/dashboard", "/dashboard"),
    ).toBe("/dashboard/hours");
    expect(safeRedirectPath("/master", "/dashboard", "/dashboard")).toBe(
      "/dashboard",
    );
  });
});
