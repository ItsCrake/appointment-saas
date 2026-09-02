import { randomBytes } from "node:crypto";

/**
 * The Siri bearer token: minting it, recognising it, and finding it on a
 * request.
 *
 * ---------------------------------------------------------------------------
 * **Prefixed, so a leaked one is identifiable.** `bzm_` costs four characters
 * and buys the thing every secret-scanner needs: a shape. A bare hex string in
 * a paste, a log or a public gist is indistinguishable from a hundred other
 * kinds of id; `bzm_…` is greppable, and an owner looking at a Shortcut a year
 * later can tell what it belongs to.
 *
 * **192 bits from `randomBytes`.** Not `randomUUID`, which is 122 bits of
 * entropy in a shape this product already uses for cancel and invite tokens —
 * a value that reads like those and grants far more than those is a value
 * somebody will eventually treat like those.
 *
 * **`base64url`, not hex.** Same entropy in two thirds the characters, and it
 * survives a query string without escaping, which matters because Apple
 * Shortcuts builds URLs by string concatenation.
 * ---------------------------------------------------------------------------
 */
export const SIRI_TOKEN_PREFIX = "bzm_";

/** 24 bytes → 32 base64url characters, 36 with the prefix. */
const TOKEN_BYTES = 24;

export function generateSiriToken(): string {
  return `${SIRI_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/**
 * Whether a string is even shaped like one of ours.
 *
 * A cheap gate in front of the database, so a scanner spraying `?token=admin`
 * costs a regex rather than an indexed lookup. It says nothing about whether
 * the token is *valid* — only the column can answer that.
 */
export function looksLikeSiriToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${SIRI_TOKEN_PREFIX}[A-Za-z0-9_-]{32}$`).test(value)
  );
}

/**
 * Pulls the token off a request, header first.
 *
 * ---------------------------------------------------------------------------
 * **Both, and the header is the one to prefer.** A query string is copied into
 * access logs, proxy logs and analytics by default — the header is not — so
 * `Authorization: Bearer …` is the right way to send this and is checked first.
 *
 * The query string is supported anyway, and not grudgingly: Apple's Shortcuts
 * app can build a URL in one action and needs an extra "Get contents of URL"
 * configuration step to attach a header, and a feature an owner cannot set up
 * is not more secure — it is just unused. `next.config.ts` already marks
 * `/api/:path*` `no-store`, and this route adds `noindex` on top.
 *
 * Accepts `Bearer <token>` and a bare token, because half the tutorials for
 * Shortcuts omit the scheme and an owner who pastes the token alone should get
 * their calendar rather than a 401 they cannot debug.
 * ---------------------------------------------------------------------------
 */
export function readSiriToken(request: {
  headers: { get(name: string): string | null };
  nextUrl?: { searchParams: URLSearchParams };
  url?: string;
}): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const bare = header.replace(/^Bearer\s+/i, "").trim();
    if (looksLikeSiriToken(bare)) return bare;
  }

  const params =
    request.nextUrl?.searchParams ??
    (request.url ? new URL(request.url).searchParams : null);

  const fromQuery = params?.get("token")?.trim();
  return looksLikeSiriToken(fromQuery) ? fromQuery : null;
}
