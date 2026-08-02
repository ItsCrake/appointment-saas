import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Theme                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The accent palette an owner can pick. The actual colour values live in
 * `globals.css` under `[data-accent="…"]`, because Tailwind cannot generate a
 * class from a runtime string (`bg-${colour}-600` is never emitted) and because
 * only CSS can carry the light/dark variants of each swatch.
 *
 * This list is the source of truth for *which* names are legal; the stylesheet
 * is the source of truth for what they look like. Adding one means editing
 * both — the test asserts they agree.
 */
export const THEME_COLORS = [
  "indigo",
  "emerald",
  "rose",
  "amber",
  "violet",
  "cyan",
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];

export const DEFAULT_THEME: ThemeColor = "indigo";

/** Hebrew labels and a swatch for the dashboard picker. */
export const THEME_LABELS: Record<ThemeColor, string> = {
  indigo: "אינדיגו",
  emerald: "ירוק",
  rose: "ורוד",
  amber: "כתום",
  violet: "סגול",
  cyan: "תכלת",
};

export function isThemeColor(value: unknown): value is ThemeColor {
  return (
    typeof value === "string" &&
    (THEME_COLORS as readonly string[]).includes(value)
  );
}

/** Never throws: a column written outside the app still renders a valid page. */
export function toThemeColor(value: unknown): ThemeColor {
  return isThemeColor(value) ? value : DEFAULT_THEME;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

export const HERO_MEDIA_TYPES = ["image", "video"] as const;
export type HeroMediaType = (typeof HERO_MEDIA_TYPES)[number];

/**
 * Only http(s). Blocks `javascript:` and keeps `data:` payloads out of a column
 * that is rendered straight into `src`, which is the one place a hostile value
 * would reach a browser.
 */
export function isSafeMediaUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const mediaUrlSchema = z
  .string()
  .trim()
  .max(500, "הכתובת ארוכה מדי")
  .refine(isSafeMediaUrl, "יש להזין כתובת http/https תקינה");

/* -------------------------------------------------------------------------- */
/* Gallery                                                                     */
/* -------------------------------------------------------------------------- */

export const MAX_GALLERY_IMAGES = 12;

export const gallerySchema = z
  .array(mediaUrlSchema)
  .max(MAX_GALLERY_IMAGES, `עד ${MAX_GALLERY_IMAGES} תמונות`);

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export const MAX_REVIEWS = 50;

export const reviewSchema = z.object({
  id: z.string().min(1),
  clientName: z.string().trim().min(1, "יש להזין שם").max(80, "השם ארוך מדי"),
  rating: z
    .number()
    .int("דירוג חייב להיות מספר שלם")
    .min(1, "דירוג מינימלי הוא 1")
    .max(5, "דירוג מקסימלי הוא 5"),
  comment: z.string().trim().max(500, "החוות דעת ארוכה מדי"),
  /** "YYYY-MM-DD". A display date, not an instant — no timezone maths on it. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
});

export type Review = z.infer<typeof reviewSchema>;

export const reviewsSchema = z.array(reviewSchema).max(MAX_REVIEWS);

/* -------------------------------------------------------------------------- */
/* Defensive reads                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `jsonb` accepts anything the database is told to store, including rows
 * written by a migration, a seed, or psql. The public page must not blow up on
 * a malformed value, so reads drop what does not parse instead of throwing.
 */
export function parseGallery(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (url): url is string => typeof url === "string" && isSafeMediaUrl(url),
  );
}

export function parseReviews(value: unknown): Review[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = reviewSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Mean rating to one decimal, or null when there is nothing to average. */
export function averageRating(reviews: Review[]): number | null {
  if (reviews.length === 0) return null;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return Math.round((total / reviews.length) * 10) / 10;
}
