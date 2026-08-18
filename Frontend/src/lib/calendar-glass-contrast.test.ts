import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { THEME_COLORS, type ThemeColor } from "@/lib/branding";

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
    week: { tint: 0.16, base: null },
    day: { tint: 0.18, base: { color: hex("#ffffff"), alpha: 0.9 } },
  },
  dark: {
    week: { tint: 0.26, base: { color: hex("#09090b"), alpha: 0.55 } },
    day: { tint: 0.26, base: { color: hex("#09090b"), alpha: 0.88 } },
  },
} as const;

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

/** The finished surface a card's text actually sits on. */
function surface(
  name: ThemeColor,
  mode: "light" | "dark",
  view: "week" | "day",
): Rgb {
  const { base, layers } = ground(name, mode);
  const glass = GLASS[mode][view];

  return composite(base, [
    ...layers,
    ...(glass.base ? [{ color: glass.base.color, alpha: glass.base.alpha }] : []),
    { color: accentOf(name), alpha: glass.tint },
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
    ["--accent) 16%", "light week tint"],
    ["--accent) 18%", "light day tint"],
    ["--accent) 26%", "dark tint"],
    ["rgb(255 255 255 / 0.9)", "light day base"],
    ["rgb(9 9 11 / 0.55)", "dark week base"],
    ["rgb(9 9 11 / 0.88)", "dark day base"],
  ])("declares %s", (fragment) => {
    expect(CSS).toContain(fragment);
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

describe("every glass surface clears AA against the text on it", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const view of ["week", "day"] as const) {
      it.each([...THEME_COLORS])(`${mode} ${view}: %s`, (name) => {
        const paint = surface(name, mode, view);
        const text = mode === "light" ? INK : PAPER;

        expect(ratio(paint, text)).toBeGreaterThanOrEqual(FLOOR);

        /**
         * The secondary line is `opacity-75` — the ink itself at 75% over the
         * surface, which is the lowest-contrast text on the card and the one an
         * owner reads the *time* from.
         */
        const muted = composite(paint, [{ color: text, alpha: 0.75 }]);
        expect(ratio(paint, muted)).toBeGreaterThanOrEqual(FLOOR);
      });
    }
  }
});
