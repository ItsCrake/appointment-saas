/**
 * One home for the product name, so a rename is a single edit rather than a
 * grep across metadata, chrome and email. The previous name lived in nine
 * places and drifted the moment the hero changed.
 *
 * The Latin form carries a full stop as part of the wordmark ("Bazman."); the
 * Hebrew form is "בזמן.". Metadata uses the bare Latin name without the stop,
 * because a trailing period reads as a sentence break in a search result.
 */
export const BRAND = {
  /** Wordmark, Latin. Includes the stop — it is part of the mark. */
  wordmark: "Bazman.",
  /** Wordmark, Hebrew. */
  wordmarkHe: "בזמן.",
  /** Plain name for prose, titles and OG tags. No stop. */
  name: "Bazman",
  nameHe: "בזמן",
  tagline: "מערכת ניהול תורים מתקדמת, מדויקת וללא חורים ביומן.",
  title: "Bazman — מערכת ניהול תורים חכמה לעסקים",
} as const;

/**
 * The mark is rendered as `Bazman` + a teal `.` in several places. Splitting
 * it here keeps the two halves from drifting apart in the markup.
 */
export const BRAND_MARK = {
  stem: "Bazman",
  dot: ".",
} as const;
