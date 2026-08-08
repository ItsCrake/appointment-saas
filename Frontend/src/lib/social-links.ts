/**
 * Social profiles for the public booking page.
 *
 * Pure, like `branding.ts`, and for the same reason: **normalise on write,
 * re-validate on read**. A seed or a psql session can write past the app, and
 * the public page has to render regardless — a bad value produces no icon,
 * never a broken page or a link that navigates somewhere unintended.
 */

export const SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "tiktok",
  "whatsapp",
  "website",
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialProfiles = {
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  /** A phone number, not a URL. */
  whatsapp: string | null;
  website: string | null;
};

export type SocialLink = {
  platform: SocialPlatform;
  /** Ready to put in an href. Always absolute and always https, bar tel:. */
  href: string;
  /** What a screen reader announces, and the title attribute. */
  label: string;
};

const LABEL: Record<SocialPlatform, string> = {
  instagram: "אינסטגרם",
  facebook: "פייסבוק",
  tiktok: "טיקטוק",
  whatsapp: "וואטסאפ",
  website: "אתר האינטרנט",
};

/** Where a bare handle gets sent, per platform. */
const HANDLE_BASE: Partial<Record<SocialPlatform, string>> = {
  instagram: "https://instagram.com/",
  facebook: "https://facebook.com/",
  tiktok: "https://tiktok.com/@",
};

/**
 * Only these hosts are accepted for a full URL, so a value that looks like a
 * profile link cannot quietly point somewhere else.
 *
 * The public page carries a business's own links, and an owner pasting a
 * shortened or tracking URL is far more likely than an attack — but this is a
 * page clients trust because the business sent them to it, so "instagram.com"
 * meaning instagram.com is worth enforcing rather than assuming.
 */
const ALLOWED_HOSTS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com", "instagr.am"],
  facebook: ["facebook.com", "fb.com", "fb.me", "m.facebook.com"],
  tiktok: ["tiktok.com"],
  whatsapp: ["wa.me", "api.whatsapp.com", "whatsapp.com"],
  website: [],
};

function stripHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function hostAllowed(platform: SocialPlatform, host: string): boolean {
  const allowed = ALLOWED_HOSTS[platform];
  // An empty list means "any host" — that is the website field, which by
  // definition points at whatever the business runs.
  if (allowed.length === 0) return true;
  return allowed.includes(stripHost(host));
}

/**
 * A handle, with the decoration owners habitually include stripped off.
 *
 * `@name`, `name/`, and a whole URL all have to arrive at the same stored
 * value, because the same owner will type all three across two sittings.
 */
export function normaliseHandle(value: string): string {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Israeli mobile numbers to E.164 without the `+`, which is the form `wa.me`
 * wants.
 *
 * `050-123-4567` → `972501234567`. A number already in international form is
 * left alone. Anything that is not plausibly a phone number returns null, so
 * the icon simply does not render.
 */
export function normaliseWhatsapp(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return null;

  const bare = digits.replace(/^\+/, "");

  // Local form: leading 0 is dropped and replaced by the country code.
  if (/^0\d{8,9}$/.test(bare)) return `972${bare.slice(1)}`;
  // Already international.
  if (/^972\d{8,9}$/.test(bare)) return bare;
  // Some other country, in international form. Accepted as-is: the audience is
  // Israeli but a tenant may well have an overseas number.
  if (/^\d{9,15}$/.test(bare)) return bare;

  return null;
}

/**
 * A stored value to an absolute URL, or null if it cannot be trusted.
 *
 * Accepts both a bare handle and a full profile URL for the three social
 * platforms, because owners paste whichever their phone gave them.
 */
export function toProfileUrl(
  platform: SocialPlatform,
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  if (platform === "whatsapp") {
    const phone = normaliseWhatsapp(value);
    return phone ? `https://wa.me/${phone}` : null;
  }

  const looksLikeUrl = /^https?:\/\//i.test(value) || value.includes(".");

  if (looksLikeUrl) {
    // A bare domain still has to become absolute, or the browser resolves it
    // against this site and the link goes nowhere.
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;

    try {
      const url = new URL(withScheme);
      // http:// upgraded rather than rejected: an owner pasting an old link
      // should not silently lose their icon.
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      url.protocol = "https:";
      if (!hostAllowed(platform, url.hostname)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  const base = HANDLE_BASE[platform];
  if (!base) return null;

  const handle = normaliseHandle(value);
  // Real handles are alphanumerics, dots and underscores. Rejecting the rest
  // is what stops `../` or a query string riding along into the href.
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) return null;

  return `${base}${handle}`;
}

/**
 * Everything configured, in a fixed order, ready to render.
 *
 * Order is declared rather than derived from the row so the icon row looks the
 * same on every tenant's page.
 */
export function buildSocialLinks(profiles: SocialProfiles): SocialLink[] {
  const raw: Record<SocialPlatform, string | null> = {
    instagram: profiles.instagram,
    facebook: profiles.facebook,
    tiktok: profiles.tiktok,
    whatsapp: profiles.whatsapp,
    website: profiles.website,
  };

  const links: SocialLink[] = [];

  for (const platform of SOCIAL_PLATFORMS) {
    const href = toProfileUrl(platform, raw[platform]);
    if (href) links.push({ platform, href, label: LABEL[platform] });
  }

  return links;
}
