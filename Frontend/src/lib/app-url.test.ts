import { describe, expect, it } from "vitest";

import {
  authRedirectOrigin,
  bookingUrlFor,
  isLocalOrigin,
  originFromHeaders,
  pickAppUrl,
} from "@/lib/app-url";

const headers = (map: Record<string, string>) => (name: string) =>
  map[name] ?? null;

describe("pickAppUrl", () => {
  it("prefers the configured origin", () => {
    // It is the only value that is also correct inside a notification email,
    // where there is no request to inspect.
    expect(pickAppUrl("https://bazman.app", "https://preview.vercel.app")).toBe(
      "https://bazman.app",
    );
  });

  it("falls back to the runtime origin when nothing is configured", () => {
    expect(pickAppUrl(null, "https://bazman.app")).toBe("https://bazman.app");
    expect(pickAppUrl("", "https://bazman.app")).toBe("https://bazman.app");
    expect(pickAppUrl("   ", "https://bazman.app")).toBe("https://bazman.app");
  });

  it("overrides a localhost env when the request came from a real host", () => {
    // The bug an alpha tester hit: an owner copied their booking link and got
    // http://localhost:3000/their-slug, which nobody else can open.
    expect(pickAppUrl("http://localhost:3000", "https://bazman.app")).toBe(
      "https://bazman.app",
    );
    expect(pickAppUrl("http://127.0.0.1:3000", "https://bazman.app")).toBe(
      "https://bazman.app",
    );
  });

  it("keeps localhost when the request really is local", () => {
    expect(pickAppUrl("http://localhost:3000", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("never lets a runtime origin override a real configured domain", () => {
    // A preview deployment or a proxied host must not rewrite the canonical
    // domain an owner has already shared.
    expect(pickAppUrl("https://bazman.app", "https://sneaky.example")).toBe(
      "https://bazman.app",
    );
  });

  it("strips trailing slashes from either side", () => {
    expect(pickAppUrl("https://bazman.app/", null)).toBe("https://bazman.app");
    expect(pickAppUrl(null, "https://bazman.app///")).toBe(
      "https://bazman.app",
    );
  });

  it("degrades to localhost rather than producing an empty origin", () => {
    expect(pickAppUrl(null, null)).toBe("http://localhost:3000");
  });
});

describe("isLocalOrigin", () => {
  it("recognises the loopback family", () => {
    for (const origin of [
      "http://localhost",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:8080",
    ]) {
      expect(isLocalOrigin(origin)).toBe(true);
    }
  });

  it("does not treat a real domain as local", () => {
    expect(isLocalOrigin("https://bazman.app")).toBe(false);
    // Substring matches must not count: this is a real, routable host.
    expect(isLocalOrigin("https://localhost.attacker.example")).toBe(false);
  });

  it("returns false for something that is not a URL", () => {
    expect(isLocalOrigin("bazman.app")).toBe(false);
    expect(isLocalOrigin("")).toBe(false);
  });
});

describe("authRedirectOrigin", () => {
  it("uses the configured origin and ignores the request entirely", () => {
    // The opposite of pickAppUrl on purpose. Supabase only honours a
    // redirect_to that is on its allow-list, and that list is written against
    // the canonical domain — a preview URL is not on it, so honouring the
    // request here is what drops the user on the home page.
    expect(
      authRedirectOrigin("https://bazman.app", "https://preview.vercel.app"),
    ).toEqual({ origin: "https://bazman.app", fromRequestHeader: false });
  });

  it("does not promote a request header even when the env says localhost", () => {
    // pickAppUrl deliberately *does* override localhost from the request, to
    // rescue a share link. Doing the same here would build a password-reset
    // link out of a header an attacker can forge.
    expect(
      authRedirectOrigin("http://localhost:3000", "https://attacker.example"),
    ).toEqual({ origin: "http://localhost:3000", fromRequestHeader: false });
  });

  it("falls back to the request origin only when nothing is configured", () => {
    // Local development. `check:env --production` refuses to deploy without
    // the variable, and the caller logs a warning when this branch is taken.
    expect(authRedirectOrigin(null, "http://localhost:3000")).toEqual({
      origin: "http://localhost:3000",
      fromRequestHeader: true,
    });
    expect(authRedirectOrigin("  ", "https://bazman.app")).toEqual({
      origin: "https://bazman.app",
      fromRequestHeader: true,
    });
  });

  it("strips a trailing slash so the callback URL has no double slash", () => {
    // `https://bazman.app//auth/confirm` is a different path to Supabase's
    // allow-list matcher, and to Next's router.
    expect(authRedirectOrigin("https://bazman.app/", null).origin).toBe(
      "https://bazman.app",
    );
  });

  it("builds the exact callback the allow-list has to contain", () => {
    const { origin } = authRedirectOrigin("https://bazman.app", null);
    expect(`${origin}/auth/confirm?next=/login/reset`).toBe(
      "https://bazman.app/auth/confirm?next=/login/reset",
    );
  });
});

describe("originFromHeaders", () => {
  it("prefers the forwarded host and protocol", () => {
    expect(
      originFromHeaders(
        headers({
          "x-forwarded-host": "bazman.app",
          "x-forwarded-proto": "https",
          host: "internal-1.vercel.internal",
        }),
      ),
    ).toBe("https://bazman.app");
  });

  it("takes the first protocol from a proxy chain", () => {
    expect(
      originFromHeaders(
        headers({ host: "bazman.app", "x-forwarded-proto": "https,http" }),
      ),
    ).toBe("https://bazman.app");
  });

  it("assumes https for a remote host and http for a local one", () => {
    expect(originFromHeaders(headers({ host: "bazman.app" }))).toBe(
      "https://bazman.app",
    );
    expect(originFromHeaders(headers({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("returns null when there is no host at all", () => {
    expect(originFromHeaders(headers({}))).toBeNull();
  });
});

describe("bookingUrlFor", () => {
  it("joins the origin and slug without doubling the slash", () => {
    expect(bookingUrlFor("https://bazman.app/", "demo-barber")).toBe(
      "https://bazman.app/demo-barber",
    );
  });
});
