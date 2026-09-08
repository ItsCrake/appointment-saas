/**
 * A second address for a shop, in another language.
 *
 * ---------------------------------------------------------------------------
 * **An alias, not a copy, and the difference is not tidiness.** The obvious way
 * to show a Spanish booking page is a second `businesses` row — and it would
 * break the dashboard. `getBusinessByOwner` selects `.limit(1)` with no
 * ordering, so a second row under the same account makes *which shop the owner
 * sees* a question Postgres answers differently on different days. An alias
 * resolves to the same row: one calendar, one set of services, one of
 * everything, reachable at two addresses.
 *
 * **It is display-only.** Nothing here changes what is stored — the shop is
 * still Hebrew, its services still have the names the owner typed, and a
 * booking made through the Spanish address lands in the same diary as any
 * other. The locale decides how the page is *rendered* and nothing else, which
 * is what makes this safe to point at a live tenant.
 *
 * **Both readers must agree.** `activeBusinessSlugExists` warns in its own
 * comment that its predicate has to match `getActiveBusinessBySlug`, because
 * the proxy asks the cheap one before the page renders — an alias known to one
 * and not the other is a 404 on a page that would have worked. So resolution
 * lives here, in one function, and both call it.
 * ---------------------------------------------------------------------------
 */

export const LOCALES = ["he", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/** Everything the product was built in. Anything else is a showcase. */
export const DEFAULT_LOCALE: Locale = "he";

/**
 * The alias addresses, and what each one points at.
 *
 * A closed map rather than a slug convention — `-es` as a *rule* would silently
 * capture a real shop that happened to choose that slug, and hand a Spanish
 * page to their clients. Adding one is a deliberate edit.
 */
const ALIASES: Record<string, { source: string; locale: Locale }> = {
  "demo-barber-es": { source: "demo-barber", locale: "es" },
};

export type ResolvedSlug = {
  /** The slug to look the business up by. */
  slug: string;
  /** How to render it. */
  locale: Locale;
  /** Whether this address is an alias rather than the shop's own. */
  alias: boolean;
};

/**
 * The business slug and language for a public address.
 *
 * An unknown slug passes straight through, so a real shop is never affected by
 * the existence of this file.
 */
export function resolveSlug(slug: string): ResolvedSlug {
  const alias = ALIASES[slug.trim().toLowerCase()];

  return alias
    ? { slug: alias.source, locale: alias.locale, alias: true }
    : { slug, locale: DEFAULT_LOCALE, alias: false };
}

/** Every alias address, for the sitemap and for tests that assert coverage. */
export function aliasSlugs(): string[] {
  return Object.keys(ALIASES);
}

/**
 * Which way the page reads.
 *
 * Hebrew is RTL and the entire layout was built for it; Spanish is not, and a
 * Spanish page rendered right-to-left is not a translation, it is a mistake
 * with translated words in it.
 */
export function directionFor(locale: Locale): "rtl" | "ltr" {
  return locale === "he" ? "rtl" : "ltr";
}
