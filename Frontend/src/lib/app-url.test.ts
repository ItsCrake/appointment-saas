import { describe, expect, it } from "vitest";

import {
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
