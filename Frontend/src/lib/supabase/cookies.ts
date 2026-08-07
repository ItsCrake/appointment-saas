import type { CookieOptions } from "@supabase/ssr";

/**
 * Security flags forced onto every Supabase auth cookie.
 *
 * Declared once and spread *after* the library's own options, so these five
 * cannot be weakened by whatever `@supabase/ssr` decides to send. The server
 * client and `proxy.ts` both write session cookies, and two copies of this
 * would eventually disagree.
 *
 * - `httpOnly` is the one that matters: it puts the session out of reach of
 *   `document.cookie`, so an XSS bug cannot read the token and walk away with
 *   the account. It is safe here because nothing in this app reads the session
 *   from the browser — every check runs on the server.
 * - `secure` only in production, because local development is plain http and a
 *   secure cookie would simply never be stored.
 * - `sameSite: lax` lets the cookie ride a top-level navigation back from the
 *   email-confirmation link while still being withheld from cross-site POSTs.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const satisfies Partial<CookieOptions>;

/** Merges the library's options with ours, ours winning. */
export function hardenCookieOptions(options: CookieOptions): CookieOptions {
  return { ...options, ...AUTH_COOKIE_OPTIONS };
}
