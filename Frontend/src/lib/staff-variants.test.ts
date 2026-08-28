import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAFF_COLORS } from "./staff-colors";
import {
  STAFF_VARIANT_COUNT,
  staffVariantClass,
  staffVariants,
} from "./staff-variants";

const member = (id: string, color: string) => ({ id, color });

describe("staffVariants", () => {
  it("leaves a roster of distinct colours entirely alone", () => {
    // The whole mechanism is opt-in by collision. A shop where everybody picked
    // differently must render exactly as it did before this existed, or the
    // texture stops being information and becomes decoration on every card.
    const variants = staffVariants([
      member("a", "rose"),
      member("b", "sky"),
      member("c", "violet"),
    ]);

    expect([...variants.values()]).toEqual([0, 0, 0]);
    expect(staffVariantClass(variants.get("a"))).toBeNull();
  });

  it("gives the first holder of a colour the untouched solid bar", () => {
    // Positional, not "everyone who collides gets a texture": one of the pair
    // has to stay solid or a two-person shop has two textures and no baseline.
    const variants = staffVariants([
      member("first", "violet"),
      member("second", "violet"),
    ]);

    expect(variants.get("first")).toBe(0);
    expect(variants.get("second")).toBe(1);
    expect(staffVariantClass(variants.get("first"))).toBeNull();
    expect(staffVariantClass(variants.get("second"))).toBe("cal-dup-1");
  });

  it("counts within a colour, not across the roster", () => {
    // Two independent collisions each restart from the solid. An index that
    // ran across the whole team would hand the second amber a texture because
    // of something two violets did.
    const variants = staffVariants([
      member("v1", "violet"),
      member("a1", "amber"),
      member("v2", "violet"),
      member("a2", "amber"),
    ]);

    expect(variants.get("v1")).toBe(0);
    expect(variants.get("a1")).toBe(0);
    expect(variants.get("v2")).toBe(1);
    expect(variants.get("a2")).toBe(1);
  });

  it("is stable for a given roster order", () => {
    // The roster arrives in a total order (`sortOrder, createdAt, id`), and a
    // texture that moved between reloads would be worse than no texture: the
    // owner would learn it means nothing.
    const team = [
      member("a", "sky"),
      member("b", "sky"),
      member("c", "sky"),
    ];

    expect([...staffVariants(team).entries()]).toEqual([
      ...staffVariants(team).entries(),
    ]);
  });

  it("cycles rather than inventing a shade past the treatments it has", () => {
    // Five providers on one colour is past what four treatments can separate.
    // It repeats — documented, and the name on the card is the fallback —
    // rather than producing an index with no class behind it.
    const team = Array.from({ length: 5 }, (_, i) => member(`s${i}`, "rose"));
    const variants = staffVariants(team);

    expect(variants.get("s4")).toBe(4 % STAFF_VARIANT_COUNT);
    for (const value of variants.values()) {
      expect(value).toBeLessThan(STAFF_VARIANT_COUNT);
    }
  });

  it("names a class that the stylesheet actually defines", () => {
    /**
     * The half of this that a type cannot catch. `staffVariantClass` builds a
     * class name by arithmetic, and Tailwind never emits these — they are hand
     * written in `globals.css`. An off-by-one here is a bar with no texture on
     * it and nothing anywhere that fails.
     */
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    for (let variant = 1; variant < STAFF_VARIANT_COUNT; variant++) {
      const name = staffVariantClass(variant);
      expect(name).not.toBeNull();
      expect(css).toContain(`.${name} {`);
    }
  });

  it("stays within the defined classes for every legal colour", () => {
    // One provider per colour plus a duplicate of each: the widest roster the
    // picker can actually produce without repeating a colour three times.
    const team = [...STAFF_COLORS, ...STAFF_COLORS].map((color, i) =>
      member(`s${i}`, color),
    );

    for (const variant of staffVariants(team).values()) {
      const name = staffVariantClass(variant);
      if (name) expect(name).toMatch(/^cal-dup-[1-3]$/);
    }
  });
});
