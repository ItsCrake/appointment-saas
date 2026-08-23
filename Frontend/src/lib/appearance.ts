/**
 * How a tenant's booking page is dressed (0027).
 *
 * ---------------------------------------------------------------------------
 * **Names, never values.** Identical reasoning to `branding.ts`: Tailwind
 * cannot emit a class from a runtime string, so every choice here becomes a
 * `data-*` attribute on the page root and the stylesheet turns it into custom
 * properties. This module owns *which names are legal*; `globals.css` owns what
 * they look like, and a test asserts the two agree.
 *
 * **Four axes, chosen because they are the four an owner actually asks for.**
 * Surface treatment, corner softness, how services are shown, and how hard the
 * hero darkens under its text. Every one of them is visible on the page within
 * a second of changing it — which is the bar for a setting existing at all.
 *
 * **No hex anywhere.** An owner picks a swatch, not a colour. That is a real
 * constraint rather than a missing feature: every accent in `THEME_COLORS` has
 * a measured AA contrast pair, and a free colour well would put unreadable
 * white-on-yellow buttons in front of a stranger trying to book.
 * ---------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* Card surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `glass` is the one that needs justifying, because blur used as decoration is
 * a costume. It earns its place here by having something to read through: a
 * page in glass mode also gets an accent wash behind the content column, so the
 * cards are tinted panels over a coloured ground rather than grey paint on
 * white. The tint is held low for the same reason `.cal-glass` holds 16% — body
 * text has to keep its margin over AA on all six swatches.
 */
export const CARD_STYLES = ["elevated", "glass", "flat"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];
export const DEFAULT_CARD_STYLE: CardStyle = "elevated";

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  elevated: "מוגבה",
  glass: "זכוכית",
  flat: "שטוח",
};

export const CARD_STYLE_HINTS: Record<CardStyle, string> = {
  elevated: "כרטיסים לבנים עם צל רך",
  glass: "שקיפות עדינה בגוון שבחרתם",
  flat: "קו מתאר דק, בלי צל",
};

/* -------------------------------------------------------------------------- */
/* Corner softness                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Three steps, not a slider. A number here would let an owner set 3px on a card
 * and 40px on the button inside it, and the page's geometry is a brand
 * commitment — pill for interactive, a large radius for containers, one step
 * tighter for a surface nested in one. Each option moves that whole scale
 * together so the relationship survives.
 */
export const CORNER_STYLES = ["soft", "rounded", "round"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const DEFAULT_CORNER_STYLE: CornerStyle = "rounded";

export const CORNER_STYLE_LABELS: Record<CornerStyle, string> = {
  soft: "מעודן",
  rounded: "מעוגל",
  round: "רך מאוד",
};

/* -------------------------------------------------------------------------- */
/* Service layout                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `showcase` is only worth offering to a shop whose services carry images — a
 * tattoo studio or a nail salon sells the look, and a row of text does not.
 * `compact` stays the default because it is the faster read, and the booking
 * flow's job is a stranger's minute.
 *
 * The page falls back to `compact` on its own when no service has an image, so
 * choosing `showcase` and uploading nothing cannot produce a wall of empty
 * frames. See `resolveServiceLayout`.
 */
export const SERVICE_LAYOUTS = ["compact", "showcase"] as const;
export type ServiceLayout = (typeof SERVICE_LAYOUTS)[number];
export const DEFAULT_SERVICE_LAYOUT: ServiceLayout = "compact";

export const SERVICE_LAYOUT_LABELS: Record<ServiceLayout, string> = {
  compact: "רשימה",
  showcase: "תמונות",
};

export const SERVICE_LAYOUT_HINTS: Record<ServiceLayout, string> = {
  compact: "שורה לכל שירות — הקריאה המהירה ביותר",
  showcase: "כרטיס תמונה לכל שירות. דורש תמונות לשירותים",
};

/* -------------------------------------------------------------------------- */
/* Hero overlay                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How hard the gradient over the hero media runs, 0–90.
 *
 * A percentage rather than a set of names because this one genuinely is
 * continuous: the right value depends on the photograph the owner uploaded, and
 * a bright shopfront and a dark studio need different answers to the same
 * question. It is the only numeric control here for that reason.
 *
 * **Capped at 90, floored at 0.** 100 would be a black rectangle where a hero
 * used to be — a setting whose extreme deletes the thing it modifies is a trap,
 * not a range.
 */
export const HERO_OVERLAY_MIN = 0;
export const HERO_OVERLAY_MAX = 90;
export const DEFAULT_HERO_OVERLAY = 45;

/**
 * Clamps to the legal range; a column written outside the app still renders.
 *
 * **`null` is checked before the numeric coercion, not after.** `Number(null)`
 * is `0`, which is finite — so the obvious version of this reads a missing
 * value as "no overlay at all" and silently strips the scrim off a hero
 * instead of falling back to the default. That is the wrong direction to fail
 * in: an absent setting should look like the product, not like a bug.
 */
export function toHeroOverlay(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    return DEFAULT_HERO_OVERLAY;
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_HERO_OVERLAY;

  return Math.min(HERO_OVERLAY_MAX, Math.max(HERO_OVERLAY_MIN, Math.round(n)));
}

/* -------------------------------------------------------------------------- */
/* Coercion                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every one of these is total — a value the code no longer recognises renders
 * the default rather than throwing. The columns are `text`, so retiring an
 * option is a code change and never a migration, and a row still holding the
 * retired name keeps working.
 */
export function toCardStyle(value: unknown): CardStyle {
  return typeof value === "string" &&
    (CARD_STYLES as readonly string[]).includes(value)
    ? (value as CardStyle)
    : DEFAULT_CARD_STYLE;
}

export function toCornerStyle(value: unknown): CornerStyle {
  return typeof value === "string" &&
    (CORNER_STYLES as readonly string[]).includes(value)
    ? (value as CornerStyle)
    : DEFAULT_CORNER_STYLE;
}

export function toServiceLayout(value: unknown): ServiceLayout {
  return typeof value === "string" &&
    (SERVICE_LAYOUTS as readonly string[]).includes(value)
    ? (value as ServiceLayout)
    : DEFAULT_SERVICE_LAYOUT;
}

/**
 * The layout actually rendered, which is not always the one chosen.
 *
 * **A control that appears to work must work** — and its opposite: a control
 * whose result would be worse than its default must not silently produce that
 * result. `showcase` with no images is a column of empty frames, so it degrades
 * to `compact` until at least one service has a picture. The setting is kept,
 * so uploading an image later turns it on without the owner touching it again.
 */
export function resolveServiceLayout(
  chosen: ServiceLayout,
  services: readonly { imageUrl?: string | null }[],
): ServiceLayout {
  if (chosen !== "showcase") return chosen;
  return services.some((service) => service.imageUrl) ? "showcase" : "compact";
}

/** Everything the page root needs, resolved once on the server. */
export type Appearance = {
  cardStyle: CardStyle;
  cornerStyle: CornerStyle;
  serviceLayout: ServiceLayout;
  heroOverlay: number;
};

export function toAppearance(row: {
  cardStyle?: unknown;
  cornerStyle?: unknown;
  serviceLayout?: unknown;
  heroOverlay?: unknown;
}): Appearance {
  return {
    cardStyle: toCardStyle(row.cardStyle),
    cornerStyle: toCornerStyle(row.cornerStyle),
    serviceLayout: toServiceLayout(row.serviceLayout),
    heroOverlay: toHeroOverlay(row.heroOverlay),
  };
}
