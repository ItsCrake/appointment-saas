/**
 * The seeded demo business (`npm run db:seed`).
 *
 * It cannot simply be deactivated before launch: the landing page links to it
 * from three CTAs, and the E2E suite books against it. So it stays live — but
 * it is a fabrication, with an invented address, phone number and prices.
 *
 * That makes it the one active business that must never be indexed and must
 * never emit `LocalBusiness` structured data, which would otherwise tell
 * search engines a real shop trades at that address.
 */
export const DEMO_SLUG = "demo-barber";

export const isDemoBusiness = (slug: string) => slug === DEMO_SLUG;
