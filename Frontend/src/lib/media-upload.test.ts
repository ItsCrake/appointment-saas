import { describe, expect, it } from "vitest";

import {
  ACCEPTED_IMAGE_TYPES,
  BRANDED_KINDS,
  buildMediaPath,
  describeUploadProblem,
  MAX_UPLOAD_BYTES,
  MEDIA_BUCKET,
  publicMediaUrl,
  UPLOAD_ACCEPT,
} from "@/lib/media-upload";

const BUSINESS = "11111111-2222-3333-4444-555555555555";
const UNIQUE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("describeUploadProblem", () => {
  it("accepts every declared type at a sane size", () => {
    for (const type of ACCEPTED_IMAGE_TYPES) {
      expect(describeUploadProblem({ type, size: 1024 })).toBeNull();
    }
  });

  it("refuses SVG", () => {
    // Not an oversight. An SVG is a document that can carry script, and these
    // land in a public bucket where the URL can be opened directly rather than
    // only rendered in an <img>.
    expect(
      describeUploadProblem({ type: "image/svg+xml", size: 1024 }),
    ).not.toBeNull();
  });

  it("refuses things that are not images at all", () => {
    for (const type of ["application/pdf", "text/html", "video/mp4", ""]) {
      expect(describeUploadProblem({ type, size: 1024 })).not.toBeNull();
    }
  });

  it("allows a file exactly at the limit and refuses one byte more", () => {
    const type = "image/png";
    expect(describeUploadProblem({ type, size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(
      describeUploadProblem({ type, size: MAX_UPLOAD_BYTES + 1 }),
    ).not.toBeNull();
  });

  it("names both sizes, so the owner knows how far over they are", () => {
    const message = describeUploadProblem({
      type: "image/jpeg",
      size: 8 * 1024 * 1024,
    });

    expect(message).toContain("8MB");
    expect(message).toContain("5MB");
  });

  it("rounds a fractional size to one decimal rather than printing bytes", () => {
    const message = describeUploadProblem({
      type: "image/jpeg",
      size: Math.round(5.5 * 1024 * 1024),
    });

    expect(message).toContain("5.5MB");
  });

  it("treats an empty file as empty, not as too large", () => {
    const message = describeUploadProblem({ type: "image/png", size: 0 });
    expect(message).not.toBeNull();
    expect(message).not.toContain("0MB");
  });
});

describe("buildMediaPath", () => {
  it("puts the tenant first, so everything a business owns shares a prefix", () => {
    const path = buildMediaPath({
      businessId: BUSINESS,
      kind: "logo",
      contentType: "image/png",
      unique: UNIQUE,
    });

    expect(path).toBe(`${BUSINESS}/logo/${UNIQUE}.png`);
  });

  it("takes the extension from the MIME type, never from a filename", () => {
    // The filename is attacker-controlled and never reaches this function —
    // this asserts the mapping it uses instead.
    expect(
      buildMediaPath({
        businessId: BUSINESS,
        kind: "gallery",
        contentType: "image/jpeg",
        unique: UNIQUE,
      }),
    ).toMatch(/\.jpg$/);

    expect(
      buildMediaPath({
        businessId: BUSINESS,
        kind: "gallery",
        contentType: "image/webp",
        unique: UNIQUE,
      }),
    ).toMatch(/\.webp$/);
  });

  it("refuses anything that is not a UUID in either variable segment", () => {
    // Both are server-generated today. The check is what keeps that true after
    // a future caller decides to pass something it read from a request.
    const traversals = ["../other", "..", "a/b", BUSINESS + "/x", ""];

    for (const businessId of traversals) {
      expect(() =>
        buildMediaPath({
          businessId,
          kind: "logo",
          contentType: "image/png",
          unique: UNIQUE,
        }),
      ).toThrow();
    }

    expect(() =>
      buildMediaPath({
        businessId: BUSINESS,
        kind: "logo",
        contentType: "image/png",
        unique: "../../etc/passwd",
      }),
    ).toThrow();
  });

  it("never produces a path with a traversal or a double slash in it", () => {
    for (const kind of ["logo", "hero", "gallery", "staff"] as const) {
      const path = buildMediaPath({
        businessId: BUSINESS,
        kind,
        contentType: "image/avif",
        unique: UNIQUE,
      });

      expect(path).not.toContain("..");
      expect(path).not.toContain("//");
      expect(path.startsWith("/")).toBe(false);
    }
  });
});

describe("publicMediaUrl", () => {
  it("builds the public object URL for the bucket", () => {
    expect(
      publicMediaUrl("https://abc.supabase.co", `${BUSINESS}/logo/x.png`),
    ).toBe(
      `https://abc.supabase.co/storage/v1/object/public/${MEDIA_BUCKET}/${BUSINESS}/logo/x.png`,
    );
  });

  it("does not double the slash when the configured URL has a trailing one", () => {
    // NEXT_PUBLIC_SUPABASE_URL is pasted by hand from a dashboard, so it
    // arrives with a trailing slash often enough to be worth handling.
    expect(publicMediaUrl("https://abc.supabase.co/", "a/b.png")).toBe(
      `https://abc.supabase.co/storage/v1/object/public/${MEDIA_BUCKET}/a/b.png`,
    );
  });
});

describe("gates", () => {
  it("keeps the logo and staff portraits outside the Pro branding gate", () => {
    // A product decision, asserted so it cannot be undone by someone tidying
    // the list: the logo predates the gate and renders for every tenant, and
    // the staff picker is not part of what the upsell sells.
    expect(BRANDED_KINDS).toEqual(["hero", "gallery"]);
  });
});

describe("UPLOAD_ACCEPT", () => {
  it("offers the file picker exactly what the checks allow", () => {
    // A picker that offers more than the validator accepts produces a rejection
    // *after* the owner has chosen, which reads as a bug rather than a rule.
    expect(UPLOAD_ACCEPT.split(",")).toEqual([...ACCEPTED_IMAGE_TYPES]);
  });
});
