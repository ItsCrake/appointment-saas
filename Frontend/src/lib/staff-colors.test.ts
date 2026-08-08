import { describe, expect, it } from "vitest";

import {
  DEFAULT_STAFF_COLOR,
  STAFF_COLORS,
  STAFF_SWATCHES,
  staffSwatch,
  toStaffColor,
} from "@/lib/staff-colors";

describe("toStaffColor", () => {
  it("passes every declared swatch through", () => {
    for (const color of STAFF_COLORS) {
      expect(toStaffColor(color)).toBe(color);
    }
  });

  it("falls back for anything it does not recognise", () => {
    // The column is a varchar and a seed or a psql session can write past the
    // app, so the agenda has to render whatever is there.
    expect(toStaffColor("#7c3aed")).toBe(DEFAULT_STAFF_COLOR);
    expect(toStaffColor("chartreuse")).toBe(DEFAULT_STAFF_COLOR);
    expect(toStaffColor("")).toBe(DEFAULT_STAFF_COLOR);
    expect(toStaffColor(null)).toBe(DEFAULT_STAFF_COLOR);
    expect(toStaffColor(undefined)).toBe(DEFAULT_STAFF_COLOR);
  });

  it("never returns a value the swatch table cannot render", () => {
    for (const input of ["rose", "nonsense", null, undefined, "SLATE"]) {
      expect(STAFF_SWATCHES[toStaffColor(input)]).toBeDefined();
    }
  });
});

describe("STAFF_SWATCHES", () => {
  it("covers every declared colour", () => {
    // A colour in the list with no swatch would render as an unstyled dot.
    expect(Object.keys(STAFF_SWATCHES).sort()).toEqual(
      [...STAFF_COLORS].sort(),
    );
  });

  it("writes class names out in full, because Tailwind scans source text", () => {
    // `bg-${color}-500` is never generated. If a swatch is ever built by
    // interpolation this test is what catches it — the class would be absent
    // from the stylesheet and the dot would be invisible.
    for (const color of STAFF_COLORS) {
      const swatch = STAFF_SWATCHES[color];
      expect(swatch.dot).toContain(`bg-${color}-`);
      expect(swatch.chip).toContain(`bg-${color}-`);
      expect(swatch.chip).toContain(`text-${color}-`);
    }
  });

  it("pairs a light surface with dark ink on every chip", () => {
    // The 100/800 pairing is what makes the chips legible without measuring
    // each swatch. Amber sits at 900 because its 800 is too light on 100.
    for (const color of STAFF_COLORS) {
      const { chip } = STAFF_SWATCHES[color];
      expect(chip).toMatch(new RegExp(`bg-${color}-100\\b`));
      expect(chip).toMatch(new RegExp(`text-${color}-(800|900)\\b`));
    }
  });

  it("gives each swatch a Hebrew label for the picker", () => {
    for (const color of STAFF_COLORS) {
      expect(STAFF_SWATCHES[color].label.length).toBeGreaterThan(1);
    }
  });
});

describe("staffSwatch", () => {
  it("resolves through the same fallback rather than throwing", () => {
    expect(staffSwatch("not-a-colour")).toBe(
      STAFF_SWATCHES[DEFAULT_STAFF_COLOR],
    );
  });
});
