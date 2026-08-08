import { describe, expect, it } from "vitest";

import {
  buildSocialLinks,
  normaliseWhatsapp,
  SOCIAL_PLATFORMS,
  toProfileUrl,
  type SocialProfiles,
} from "@/lib/social-links";

const EMPTY: SocialProfiles = {
  instagram: null,
  facebook: null,
  tiktok: null,
  whatsapp: null,
  website: null,
};

describe("toProfileUrl — handles", () => {
  it("accepts the three forms an owner will actually type", () => {
    // The same person types all three across two sittings, and all three have
    // to arrive at the same link.
    for (const value of ["barkai", "@barkai", "barkai/"]) {
      expect(toProfileUrl("instagram", value)).toBe(
        "https://instagram.com/barkai",
      );
    }
  });

  it("puts the @ back for TikTok, where it is part of the path", () => {
    expect(toProfileUrl("tiktok", "barkai")).toBe("https://tiktok.com/@barkai");
  });

  it("rejects a handle carrying path or query characters", () => {
    // This is what stops `../` or a query string riding into the href.
    expect(toProfileUrl("instagram", "barkai/../evil")).toBeNull();
    expect(toProfileUrl("instagram", "barkai?next=x")).toBeNull();
    expect(toProfileUrl("instagram", "a b")).toBeNull();
  });
});

describe("toProfileUrl — full URLs", () => {
  it("keeps a real profile URL", () => {
    expect(toProfileUrl("instagram", "https://instagram.com/barkai")).toBe(
      "https://instagram.com/barkai",
    );
  });

  it("makes a bare domain absolute", () => {
    // Without a scheme the browser resolves it against this site and the link
    // goes nowhere.
    expect(toProfileUrl("website", "barkai.co.il")).toBe(
      "https://barkai.co.il/",
    );
  });

  it("upgrades http to https rather than dropping the link", () => {
    expect(toProfileUrl("website", "http://barkai.co.il")).toBe(
      "https://barkai.co.il/",
    );
  });

  it("refuses a host that is not the platform it claims to be", () => {
    // The page is trusted because the business sent the client to it, so
    // "instagram.com" has to mean instagram.com.
    expect(toProfileUrl("instagram", "https://evil.example/barkai")).toBeNull();
    expect(toProfileUrl("facebook", "https://instagram.com/x")).toBeNull();
  });

  it("accepts the platforms' alternate hosts and ignores www", () => {
    expect(toProfileUrl("facebook", "https://www.fb.me/barkai")).toBe(
      "https://www.fb.me/barkai",
    );
  });

  it("refuses a non-http scheme outright", () => {
    expect(toProfileUrl("website", "javascript:alert(1)")).toBeNull();
    expect(toProfileUrl("website", "data:text/html,x")).toBeNull();
  });

  it("lets the website field point anywhere, because that is the point", () => {
    expect(toProfileUrl("website", "https://anything.example/page")).toBe(
      "https://anything.example/page",
    );
  });
});

describe("normaliseWhatsapp", () => {
  it("converts an Israeli mobile to the form wa.me wants", () => {
    expect(normaliseWhatsapp("050-123-4567")).toBe("972501234567");
    expect(normaliseWhatsapp("0501234567")).toBe("972501234567");
    expect(normaliseWhatsapp("+972 50 123 4567")).toBe("972501234567");
  });

  it("leaves an overseas number in international form alone", () => {
    expect(normaliseWhatsapp("+44 7700 900123")).toBe("447700900123");
  });

  it("returns null for anything not plausibly a number", () => {
    // The icon then simply does not render, which is better than a link that
    // opens WhatsApp on nothing.
    expect(normaliseWhatsapp("call me")).toBeNull();
    expect(normaliseWhatsapp("123")).toBeNull();
    expect(normaliseWhatsapp("")).toBeNull();
  });
});

describe("buildSocialLinks", () => {
  it("returns nothing when nothing is configured", () => {
    expect(buildSocialLinks(EMPTY)).toEqual([]);
  });

  it("keeps a declared order so every tenant's icon row matches", () => {
    const links = buildSocialLinks({
      website: "barkai.co.il",
      whatsapp: "0501234567",
      tiktok: "barkai",
      facebook: "barkai",
      instagram: "barkai",
    });

    expect(links.map((l) => l.platform)).toEqual([...SOCIAL_PLATFORMS]);
  });

  it("drops only the entries that do not parse", () => {
    // One bad value must not take the rest of the row down with it.
    const links = buildSocialLinks({
      ...EMPTY,
      instagram: "barkai",
      facebook: "https://evil.example/x",
      whatsapp: "nonsense",
    });

    expect(links.map((l) => l.platform)).toEqual(["instagram"]);
  });

  it("labels every link in Hebrew", () => {
    const links = buildSocialLinks({ ...EMPTY, instagram: "barkai" });
    expect(links[0].label).toBe("אינסטגרם");
  });
});
