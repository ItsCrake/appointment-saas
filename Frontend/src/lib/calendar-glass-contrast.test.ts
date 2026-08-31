import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { THEME_COLORS, type ThemeColor } from "@/lib/branding";
import {
  STAFF_COLORS,
  staffSwatch,
  type StaffColor,
} from "@/lib/staff-colors";

/**
 * Contrast on the calendar's glass, measured on the **composited** surface.
 *
 * ---------------------------------------------------------------------------
 * A translucent fill over a page background is not the colour anyone wrote.
 * `getComputedStyle().backgroundColor` on such an element returns the layer's
 * own *unblended* value, which reports 1.8:1 for a surface that actually
 * measures 13:1 — a confident wrong number, which is worse than no number.
 *
 * So this rebuilds the real stack — card, open-hours band, today's tint, the
 * glass base, the glass tint — composites it, and computes the ratio against the
 * text that sits on it. Twelve surfaces: six swatches in light and dark, each
 * checked against the body text *and* against the `opacity-75` secondary line,
 * which is the weakest type on the card.
 *
 * **In code rather than in a browser, on purpose.** A one-off reading in
 * devtools proves the colour that shipped the day it was taken; this fails the
 * build the day somebody raises a tint percentage. It is the same bargain as
 * `theme-coverage.test.ts` — the invariant is checked mechanically because a
 * reviewer eventually misses it.
 *
 * The two layers the CSS uses are a plain alpha composite each, which is why
 * `globals.css` deliberately keeps the base and the tint separate rather than
 * folding them into one four-way `color-mix`: CSS premultiplies alpha through
 * polar interpolation, and re-deriving that by hand is exactly how the confident
 * wrong number gets made.
 * ---------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* oklch -> sRGB                                                              */
/* -------------------------------------------------------------------------- */

type Rgb = [number, number, number];

/** oklab -> linear sRGB, the matrices from the Oklab specification. */
function oklabToLinearSrgb(L: number, a: number, b: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear light to gamma-encoded sRGB, clamped as a browser clamps it. */
function encode(channel: number): number {
  const clamped = Math.max(0, Math.min(1, channel));
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** "oklch(51.1% 0.262 276.966)" -> [79, 70, 229]. */
function oklch(spec: string): Rgb {
  const match = spec.match(
    /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/,
  );
  if (!match) throw new Error(`not an oklch() colour: ${spec}`);

  const L = Number(match[1]) / 100;
  const C = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;

  const [r, g, b] = oklabToLinearSrgb(L, C * Math.cos(h), C * Math.sin(h));
  return [encode(r), encode(g), encode(b)];
}

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/* -------------------------------------------------------------------------- */
/* Compositing and contrast                                                   */
/* -------------------------------------------------------------------------- */

type Layer = { color: Rgb; alpha: number };

/** Source-over, in gamma space, exactly as a browser paints these. */
function composite(ground: Rgb, layers: Layer[]): Rgb {
  return layers.reduce<Rgb>(
    (below, layer) =>
      [0, 1, 2].map((i) =>
        Math.round(layer.color[i] * layer.alpha + below[i] * (1 - layer.alpha)),
      ) as Rgb,
    ground,
  );
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* -------------------------------------------------------------------------- */
/* The palette, read out of the stylesheet rather than restated               */
/* -------------------------------------------------------------------------- */

const CSS = readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

/**
 * One variable out of one `[data-accent="…"]` block.
 *
 * Read from the stylesheet so this cannot drift from what actually ships: a
 * swatch retuned in CSS is re-measured here on the next run, which is the whole
 * reason the values are not pasted in.
 *
 * `dark` picks the override inside the `prefers-color-scheme` block, which comes
 * later in the file — so it searches from the *last* occurrence backwards.
 */
function swatchVar(
  name: ThemeColor,
  variable: string,
  mode: "light" | "dark" = "light",
): string {
  const selector = `[data-accent="${name}"] {`;
  const blockStart =
    mode === "light" ? CSS.indexOf(selector) : CSS.lastIndexOf(selector);
  if (blockStart === -1) throw new Error(`no ${mode} block for ${name}`);

  const block = CSS.slice(blockStart, CSS.indexOf("}", blockStart));
  const match = block.match(new RegExp(`${variable}:\\s*([^;]+);`));

  // Every swatch but indigo re-declares --accent in its own block; indigo shares
  // the bare `[data-accent]` fallback, and only the soft tokens are overridden
  // in dark mode. Falling back to the light value is correct in both cases.
  if (!match) {
    if (mode === "dark") return swatchVar(name, variable, "light");
    throw new Error(`${name} does not declare ${variable}`);
  }

  return match[1].trim();
}

/**
 * The swatch's own accent.
 *
 * Indigo's lives in the block it shares with the bare `[data-accent]` fallback,
 * which `swatchVar` finds anyway — it keys off the single-line
 * `[data-accent="indigo"] {` half of that selector, exactly as
 * `theme-coverage.test.ts` does, so nothing here depends on the file's line
 * endings.
 */
function accentOf(name: ThemeColor): Rgb {
  return oklch(swatchVar(name, "--accent"));
}

/**
 * One staff member's hue, read out of its `.cal-staff-*` rule.
 *
 * A team shop tints each card by *who* rather than by the tenant accent, so
 * these are the colours most of a busy calendar is actually painted in — and
 * they are a second palette that has to clear AA on the same surfaces. Read from
 * the stylesheet for the same reason as the accents: a hue retuned in CSS is
 * re-measured here rather than silently escaping the check.
 */
function staffHue(name: StaffColor): Rgb {
  const selector = `.cal-staff-${name} {`;
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`no .cal-staff-${name} rule`);

  const block = CSS.slice(start, CSS.indexOf("}", start));
  const match = block.match(/--cal-hue:\s*([^;]+);/);
  if (!match) throw new Error(`.cal-staff-${name} declares no --cal-hue`);

  return oklch(match[1].trim());
}

/* -------------------------------------------------------------------------- */

/** WCAG AA for text that is not large. The card's type is 10–14px. */
const FLOOR = 4.5;

const INK = hex("#18181b"); // zinc-900, the card's text in light mode
const PAPER = hex("#fafafa"); // zinc-50, the card's text in dark mode

/**
 * The tint percentages and base alphas from `.cal-glass` / `.cal-glass-solid`.
 * Asserted against the stylesheet below, so editing one without the other fails.
 */
const GLASS = {
  light: {
    week: { tint: 0.16, tones: [0.24, 0.32, 0.4], base: null },
    day: {
      tint: 0.18,
      tones: [0.26, 0.34, 0.42],
      base: { color: hex("#ffffff"), alpha: 0.9 },
    },
  },
  dark: {
    week: {
      tint: 0.26,
      tones: [0.32, 0.38, 0.44],
      base: { color: hex("#09090b"), alpha: 0.55 },
    },
    day: {
      tint: 0.26,
      tones: [0.32, 0.38, 0.44],
      base: { color: hex("#09090b"), alpha: 0.88 },
    },
  },
} as const;

/**
 * The tone ladder `.cal-tone-*` walks when two providers share a colour.
 *
 * `0` is the base tint every card uses. The three steps above it deepen the
 * same hue so a row of same-coloured providers reads as a ladder — and each one
 * is a new surface that text has to stay legible on, which is the entire reason
 * they are measured here rather than eyeballed once. The dark ladder climbs
 * more gently on purpose: raising the tint there moves the surface *towards*
 * the light text on it, where in light mode it moves away from the dark text.
 */
const TONE_STEPS = [0, 1, 2, 3] as const;

/**
 * Everything under the card, in paint order.
 *
 * Light: the card is white, the open-hours band is zinc-50, and today's column
 * adds `--accent-soft` at 40%. Dark: the card is zinc-900, the band is zinc-800
 * at 30%, today's tint is the dark `--accent-soft` at 40%. Today's column is
 * included because it is the *darkest* ground a light card sits on and the
 * lightest a dark one does — the worst case either way.
 */
function ground(name: ThemeColor, mode: "light" | "dark") {
  if (mode === "light") {
    return {
      base: hex("#ffffff"),
      layers: [
        { color: hex("#fafafa"), alpha: 1 },
        { color: oklch(swatchVar(name, "--accent-soft")), alpha: 0.4 },
      ],
    };
  }

  return {
    base: hex("#18181b"),
    layers: [
      { color: hex("#27272a"), alpha: 0.3 },
      { color: oklch(swatchVar(name, "--accent-soft", "dark")), alpha: 0.4 },
    ],
  };
}

/**
 * The finished surface a card's text actually sits on.
 *
 * `hue` is what gets mixed into the glass: the tenant's accent on a one-chair
 * shop, or the staff member's own colour once there is a team. The ground under
 * it is always the tenant's, because `--accent-soft` paints today's column
 * whoever the booking belongs to.
 */
function surface(
  name: ThemeColor,
  mode: "light" | "dark",
  view: "week" | "day",
  hue: Rgb = accentOf(name),
  tone = 0,
): Rgb {
  const { base, layers } = ground(name, mode);
  const glass = GLASS[mode][view];
  // Step 0 is the base tint; 1–3 are the collision ladder.
  const alpha = tone === 0 ? glass.tint : glass.tones[tone - 1];

  return composite(base, [
    ...layers,
    ...(glass.base
      ? [{ color: glass.base.color, alpha: glass.base.alpha }]
      : []),
    { color: hue, alpha },
  ]);
}

describe("the oklch conversion is right before anything is measured", () => {
  /**
   * The converter is pinned to the **sRGB primaries**, whose oklch coordinates
   * are a mathematical fact rather than anyone's palette.
   *
   * ---------------------------------------------------------------------------
   * The obvious pin — "indigo should come out as Tailwind's `#4f46e5`" — is
   * wrong, and it failed loudly before this comment existed. **Tailwind v4
   * re-derived its palette in oklch with chroma beyond sRGB**, so the values in
   * `globals.css` are not conversions of the v3 hexes and do not round-trip to
   * them: `oklch(51.1% 0.262 276.966)` really is `#4f39f6`, and `#4f46e5` is a
   * different colour that v3 happened to call by the same name. Pinning to those
   * hexes tests which Tailwind release the palette was copied from, which is not
   * a property worth defending.
   *
   * Three primaries plus the achromatic ends fully constrain the transform: if
   * either matrix or the transfer function were wrong, none of these five could
   * land. That is what makes the ratios below trustworthy.
   * ---------------------------------------------------------------------------
   */
  it.each([
    ["oklch(62.8% 0.2577 29.23)", "#ff0000"],
    ["oklch(86.64% 0.2948 142.5)", "#00ff00"],
    ["oklch(45.2% 0.3132 264.05)", "#0000ff"],
  ])("%s is %s", (spec, expected) => {
    expect(oklch(spec)).toEqual(hex(expected));
  });

  it("puts the achromatic ends where they belong", () => {
    // Independent of any remembered hex: if the matrices or the transfer
    // function were wrong, white and black would not survive the round trip.
    expect(oklch("oklch(100% 0 0)")).toEqual([255, 255, 255]);
    expect(oklch("oklch(0% 0 0)")).toEqual([0, 0, 0]);

    // Oklab's L is perceptual, so 50% lightness is a mid grey by eye and lands
    // near 99/255 in sRGB — well below the arithmetic midpoint, which is the
    // whole reason the accent percentages could not be reasoned about in sRGB.
    const grey = oklch("oklch(50% 0 0)");
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    expect(grey[0]).toBeGreaterThan(90);
    expect(grey[0]).toBeLessThan(110);
  });

  it("composites a half-opaque black over white to mid grey", () => {
    expect(
      composite(hex("#ffffff"), [{ color: hex("#000000"), alpha: 0.5 }]),
    ).toEqual([128, 128, 128]);
  });

  it("agrees with the known contrast of black on white", () => {
    expect(ratio(hex("#ffffff"), hex("#000000"))).toBeCloseTo(21, 1);
  });
});

describe("the stylesheet still says what this test assumes", () => {
  // The numbers above are a copy of the CSS. If the CSS moves and this does not,
  // the measurement silently describes a surface that no longer ships.
  it.each([
    ["var(--cal-hue, var(--accent)) 16%", "light week tint"],
    ["var(--cal-hue, var(--accent)) 18%", "light day tint"],
    ["var(--cal-hue, var(--accent)) 26%", "dark tint"],
    ["rgb(255 255 255 / 0.9)", "light day base"],
    ["rgb(9 9 11 / 0.55)", "dark week base"],
    ["rgb(9 9 11 / 0.88)", "dark day base"],
    // The collision ladder. Listed one by one rather than derived, so that
    // changing a percentage in the stylesheet without changing the number this
    // suite measures fails here instead of silently measuring the old surface.
    ["var(--cal-hue, var(--accent)) 24%", "light week tone 1"],
    ["var(--cal-hue, var(--accent)) 32%", "light week tone 2"],
    ["var(--cal-hue, var(--accent)) 40%", "light week tone 3"],
    ["var(--cal-hue, var(--accent)) 26%", "light day tone 1"],
    ["var(--cal-hue, var(--accent)) 34%", "light day tone 2"],
    ["var(--cal-hue, var(--accent)) 42%", "light day tone 3"],
    ["var(--cal-hue, var(--accent)) 38%", "dark tone 2"],
    ["var(--cal-hue, var(--accent)) 44%", "dark tone 3"],
  ])("declares %s", (fragment) => {
    expect(CSS).toContain(fragment);
  });

  it("gives every tone class a rule in both views", () => {
    /**
     * `staffToneClass` builds these names by arithmetic and Tailwind never
     * emits them — they are hand written. A missing rule is a card that quietly
     * falls back to the base tint, which looks exactly like the bug the ladder
     * exists to fix.
     */
    for (let tone = 1; tone <= 3; tone++) {
      expect(CSS).toContain(`.cal-glass.cal-tone-${tone} {`);
      expect(CSS).toContain(`.cal-glass-solid.cal-tone-${tone} {`);
    }
  });

  it("falls back to the accent when no staff hue is set", () => {
    // The fallback inside `var()` is what lets a one-chair shop keep its own
    // colour. Without it every card on such a calendar would lose its tint
    // entirely, since `--cal-hue` is only ever set by a `.cal-staff-*` class.
    expect(CSS).not.toMatch(/--cal-tint:[^;]*var\(--accent\)(?!\))/);
    expect(CSS).toContain("var(--cal-hue, var(--accent))");
  });

  it("keeps the tint on the rule itself, not on :root", () => {
    // On `:root` the custom property computes there and bakes in the fallback,
    // so every tenant's calendar would come out indigo.
    const rootBlocks = CSS.split(":root {")
      .slice(1)
      .map((block) => block.slice(0, block.indexOf("\n}")))
      .join("\n");

    expect(rootBlocks).not.toContain("--cal-tint");
    expect(CSS).toContain(".cal-glass {");
  });
});

/** Both readings a card has to survive: its body text and its muted line. */
function assertLegible(paint: Rgb, mode: "light" | "dark") {
  const text = mode === "light" ? INK : PAPER;
  expect(ratio(paint, text)).toBeGreaterThanOrEqual(FLOOR);

  /**
   * The secondary lines are `opacity-75` — the ink itself at 75% over the
   * surface, which is the lowest-contrast text on the card and the one an owner
   * reads the *time* and the service name from.
   */
  const muted = composite(paint, [{ color: text, alpha: 0.75 }]);
  expect(ratio(paint, muted)).toBeGreaterThanOrEqual(FLOOR);
}

describe("every glass surface clears AA against the text on it", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const view of ["week", "day"] as const) {
      it.each([...THEME_COLORS])(`${mode} ${view}: %s`, (name) => {
        assertLegible(surface(name, mode, view), mode);
      });
    }
  }
});

describe("a team's cards are legible in every staff colour too", () => {
  /**
   * Seven hues over six grounds, because the staff tint replaces the accent in
   * the glass but not in today's column: a rose-tinted card can be sitting on an
   * amber shop's Tuesday. Measuring the hue against its own accent's ground only
   * would miss exactly that combination.
   */
  for (const mode of ["light", "dark"] as const) {
    for (const view of ["week", "day"] as const) {
      it.each([...STAFF_COLORS])(`${mode} ${view}: %s`, (staff) => {
        const hue = staffHue(staff);
        for (const accent of THEME_COLORS) {
          /**
           * Every rung of the collision ladder, not only the base tint.
           *
           * Two providers who picked the same colour get progressively deeper
           * glass so they can be told apart while scanning — and the deepest is
           * the surface most likely to have walked under the floor. Measuring
           * only the base would prove the case that was already safe.
           */
          for (const tone of TONE_STEPS) {
            assertLegible(surface(accent, mode, view, hue, tone), mode);
          }
        }
      });
    }
  }

  it("gives every staff swatch a hue to be tinted with", () => {
    // `staffSwatch(...).tint` names a class per swatch; a swatch added to the
    // list without a rule in the stylesheet would fall back to the accent and
    // two people would share a colour on the grid.
    for (const name of STAFF_COLORS) {
      expect(staffSwatch(name).tint).toBe(`cal-staff-${name}`);
      expect(() => staffHue(name)).not.toThrow();
    }
  });
});
