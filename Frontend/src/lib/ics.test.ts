import { describe, expect, it } from "vitest";

import { buildIcs } from "@/lib/ics";

const base = {
  uid: "abc-123@appointment-saas",
  startsAt: "2026-07-31T09:00:00.000Z",
  endsAt: "2026-07-31T09:30:00.000Z",
  title: "תספורת גבר, מספרת ברקאי",
};

describe("buildIcs", () => {
  it("emits UTC timestamps in the compact RFC 5545 form", () => {
    const ics = buildIcs(base);
    expect(ics).toContain("DTSTART:20260731T090000Z");
    expect(ics).toContain("DTEND:20260731T093000Z");
  });

  it("uses CRLF line endings and closes every block", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const block of ["VEVENT", "VALARM"]) {
      expect(ics).toContain(`BEGIN:${block}`);
      expect(ics).toContain(`END:${block}`);
    }
  });

  it("escapes commas, semicolons and backslashes", () => {
    const ics = buildIcs({
      ...base,
      title: "Cut, shave; style\\finish",
    });
    expect(ics).toContain("SUMMARY:Cut\\, shave\\; style\\\\finish");
  });

  it("turns newlines in the description into literal \\n", () => {
    const ics = buildIcs({ ...base, description: "שורה\nשנייה" });
    expect(ics).toContain("DESCRIPTION:שורה\\nשנייה");
    // The escape must not introduce a real break inside the property.
    expect(ics.split("\r\n").some((l) => l === "שנייה")).toBe(false);
  });

  it("folds long lines to 75 octets without splitting a Hebrew character", () => {
    const ics = buildIcs({
      ...base,
      description: "תור ארוך במיוחד ".repeat(12),
    });
    const encoder = new TextEncoder();

    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      // A split multi-byte char would surface as a replacement character.
      expect(line).not.toContain("�");
    }
    // Continuation lines are marked by a leading space.
    expect(ics).toMatch(/\r\n /);
  });

  it("omits optional properties that were not supplied", () => {
    const ics = buildIcs(base);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("URL:");
  });
});
