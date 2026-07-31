import { describe, expect, it } from "vitest";

import {
  bookingInputSchema,
  clientDetailsSchema,
  isValidPhone,
  normalizePhone,
} from "@/lib/validation";

describe("normalizePhone", () => {
  it("strips separators", () => {
    expect(normalizePhone("050-123-4567")).toBe("0501234567");
    expect(normalizePhone("050 123 4567")).toBe("0501234567");
    expect(normalizePhone("(050) 1234567")).toBe("0501234567");
  });

  it("rewrites the international prefix to a local 0", () => {
    expect(normalizePhone("+972501234567")).toBe("0501234567");
    expect(normalizePhone("00972-50-1234567")).toBe("0501234567");
  });
});

describe("isValidPhone", () => {
  it.each(["0501234567", "050-1234567", "+972-52-9876543", "054 000 0000"])(
    "accepts %s",
    (input) => {
      expect(isValidPhone(input)).toBe(true);
    },
  );

  it.each([
    ["too short", "05012345"],
    ["too long", "05012345678"],
    ["landline", "031234567"],
    ["letters", "050abcdefg"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(isValidPhone(input)).toBe(false);
  });
});

describe("clientDetailsSchema", () => {
  it("trims the name and accepts optional notes", () => {
    const parsed = clientDetailsSchema.parse({
      clientName: "  איתי ברקאי  ",
      clientPhone: "052-9876543",
    });
    expect(parsed.clientName).toBe("איתי ברקאי");
    expect(parsed.notes).toBeUndefined();
  });

  it("rejects a one-character name", () => {
    const result = clientDetailsSchema.safeParse({
      clientName: "א",
      clientPhone: "0501234567",
    });
    expect(result.success).toBe(false);
  });

  it("keeps the phone as typed — normalisation happens server-side", () => {
    const parsed = clientDetailsSchema.parse({
      clientName: "דני כהן",
      clientPhone: "050-123-4567",
    });
    expect(parsed.clientPhone).toBe("050-123-4567");
  });
});

describe("bookingInputSchema", () => {
  const valid = {
    // A slug, not a business id: the server resolves the tenant itself.
    slug: "dana-cosmetics",
    serviceId: "8a2b4c6d-1e3f-4a5b-9c7d-0e2f4a6b8c1d",
    startsAt: "2026-08-03T06:00:00.000Z",
    clientName: "דני כהן",
    clientPhone: "0501234567",
  };

  it("accepts a well-formed payload", () => {
    expect(bookingInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a payload with no slug", () => {
    const withoutSlug: Record<string, unknown> = { ...valid };
    delete withoutSlug.slug;
    expect(bookingInputSchema.safeParse(withoutSlug).success).toBe(false);
  });

  it("rejects a slug with illegal characters", () => {
    for (const slug of ["Dana Cosmetics", "dana/../admin", "דנה"]) {
      expect(bookingInputSchema.safeParse({ ...valid, slug }).success).toBe(
        false,
      );
    }
  });

  it("lower-cases the slug so lookups match the stored value", () => {
    const parsed = bookingInputSchema.parse({
      ...valid,
      slug: "Dana-Cosmetics",
    });
    expect(parsed.slug).toBe("dana-cosmetics");
  });

  it("rejects an unparseable timestamp", () => {
    const result = bookingInputSchema.safeParse({
      ...valid,
      startsAt: "next tuesday",
    });
    expect(result.success).toBe(false);
  });
});
