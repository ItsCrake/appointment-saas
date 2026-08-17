/**
 * The seeded demo businesses (`npm run db:seed`).
 *
 * They cannot simply be deactivated before launch: the landing page links to
 * one from three CTAs, and the E2E suite books against it. So they stay live —
 * but each is a fabrication, with an invented address, phone number and prices.
 *
 * That makes them the active businesses that must never be indexed and must
 * never emit `LocalBusiness` structured data, which would otherwise tell search
 * engines a real shop trades at that address.
 *
 * **A list rather than a constant, so adding one cannot forget that rule.**
 * `demo-nails` exists because a prospect who runs a nail salon should see their
 * own trade rather than a barber's, and the moment a second demo was added the
 * single `DEMO_SLUG` became a way to ship an indexed fabrication by omission.
 */
export const DEMO_SLUGS = ["demo-barber", "demo-nails"] as const;

export type DemoSlug = (typeof DEMO_SLUGS)[number];

/** The barber shop — the landing page's CTAs and the E2E suite both use it. */
export const DEMO_SLUG: DemoSlug = "demo-barber";

/** The nail studio, for beauty prospects. */
export const DEMO_NAILS_SLUG: DemoSlug = "demo-nails";

export const isDemoBusiness = (slug: string) =>
  (DEMO_SLUGS as readonly string[]).includes(slug);
