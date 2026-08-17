/**
 * Which request paths are a *tenant's* booking page, and which belong to the
 * platform.
 *
 * `/[slug]` sits at the root of the URL space, so every unmatched single-segment
 * path — `/wp-admin`, a mistyped link, a shop that closed — lands on it. The
 * proxy needs to know which of those to resolve against the database, and
 * getting the answer wrong in either direction is bad in a different way: too
 * narrow and unknown slugs keep answering 200, too broad and a real platform
 * route gets rewritten to a 404.
 *
 * Pure and free of `next/server`, so the rule is unit-testable without a
 * request — the same reason `app-url.ts` and `safe-redirect.ts` are.
 */

/**
 * Top-level path segments that are platform routes rather than tenant slugs.
 *
 * The proxy matcher cannot hold this list: Next requires matcher patterns to be
 * statically analysable literals, so a second copy would live in a regex and
 * drift from this one. It is therefore enforced here and policed by
 * `public-slug.coverage.test.ts`, which fails the build when a directory under
 * `src/app/` is missing from it. Adding a route must be a deliberate decision
 * about whether it shadows a slug, not something a reviewer happens to notice.
 */
export const RESERVED_SEGMENTS: readonly string[] = [
  "accessibility",
  "api",
  "auth",
  "b",
  "business-not-found",
  "dashboard",
  "legal",
  "login",
  "master",
];

/**
 * Sub-paths a tenant page legitimately has. Anything else under a slug is not a
 * route at all, so Next's own routing already answers it with a real 404 and
 * the proxy must leave it alone.
 */
const TENANT_SUBPATHS: readonly string[] = ["my-appointments"];

/**
 * The loosest slug shape any schema in the app accepts (`bookingInputSchema`;
 * the setup and settings forms are stricter still, at 3+ characters).
 *
 * Deliberately loose in length and deliberately strict in character set. Every
 * slug is written through Zod and lowercased before it reaches the column, so a
 * path outside this shape cannot match a row however the database is feeling —
 * which is what makes it safe to answer without asking.
 */
const SLUG_SHAPE = /^[a-z0-9-]{1,40}$/;

/**
 * A `randomUUID()` cancel token, which is what `/b/[token]` is keyed on.
 *
 * It sits in this file because a UUID **also satisfies `SLUG_SHAPE`** — 36
 * lowercase hex characters and hyphens — so without an explicit answer the
 * proxy would look one up as a shop, miss, and 404 the very link a client was
 * sent. See {@link classifyPublicPath}.
 */
const MANAGE_TOKEN_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether a candidate slug would be swallowed by the cancel-token redirect.
 *
 * Exported so the two forms that let an owner *choose* a slug refuse one up
 * front, rather than letting a shop save an address that silently resolves to
 * somebody's cancellation page. The rule lives here, beside the routing
 * decision that creates the conflict, so the two cannot drift.
 */
export function isManageTokenShape(candidate: string): boolean {
  return MANAGE_TOKEN_SHAPE.test(candidate.trim().toLowerCase());
}

export type PublicPathVerdict =
  /** A platform route, a file, or too deep to be a booking page. Let it render. */
  | { kind: "platform" }
  /** Shaped like a booking page. Only the database can say whether it exists. */
  | { kind: "tenant"; slug: string }
  /**
   * A bare cancel token at the root, which belongs at `/b/<token>`.
   *
   * WhatsApp's approved templates carry a URL button whose base was registered
   * with Meta as `https://www.bazman.app/` — without the `b/` — and Meta appends
   * only the varying tail to a base that is frozen at approval time. So the link
   * in every confirmation and 24-hour reminder arrives here, and redirecting is
   * the half of that contract this side owns.
   */
  | { kind: "manage-token"; token: string }
  /**
   * Occupies the tenant URL space but cannot possibly be a tenant — wrong case,
   * an underscore, an escape sequence. A 404 with no query behind it.
   */
  | { kind: "impossible" };

/**
 * Classifies a request path for the proxy's 404 guard.
 *
 * The three-way answer is the point. Collapsing `impossible` into `platform`
 * would send `/Demo-Barber` and `/wp_admin` down the render path to produce the
 * streamed soft 404 this guard exists to remove; collapsing it into `tenant`
 * would spend a database round trip proving something the character set already
 * settles. Bot noise is the overwhelming majority of this traffic and it should
 * cost nothing.
 */
export function classifyPublicPath(pathname: string): PublicPathVerdict {
  if (!pathname.startsWith("/")) return { kind: "platform" };

  const segments = pathname.split("/").filter(Boolean);

  // "/" — the landing page.
  if (segments.length === 0) return { kind: "platform" };
  // Deeper than any booking page goes. Next has no route for it and already
  // answers a real 404 through its own default page.
  if (segments.length > 2) return { kind: "platform" };

  const [slug, sub] = segments;

  // A dot means a file: `/favicon.ico`, `/sw.js`, `/manifest.webmanifest`.
  // Served from `public/` or by a metadata route, and never a slug.
  if (slug.includes(".")) return { kind: "platform" };

  if (RESERVED_SEGMENTS.includes(slug)) return { kind: "platform" };

  // `/some-shop/reviews` is not a route. Leave it to Next's own 404 rather
  // than claiming a URL space this app does not serve.
  if (sub !== undefined && !TENANT_SUBPATHS.includes(sub)) {
    return { kind: "platform" };
  }

  /**
   * Checked **before** the slug shape, because a UUID passes that test too and
   * whichever answer comes first wins the URL space.
   *
   * Resolving in favour of the token costs a shop the ability to register a
   * slug that is a literal UUID, which the setup and settings forms now refuse
   * via {@link isManageTokenShape} so the two cannot disagree. It buys a working
   * management link on every WhatsApp confirmation, which is not a trade that
   * needs thinking about.
   */
  if (sub === undefined && MANAGE_TOKEN_SHAPE.test(slug)) {
    return { kind: "manage-token", token: slug };
  }

  if (!SLUG_SHAPE.test(slug)) return { kind: "impossible" };

  return { kind: "tenant", slug };
}
