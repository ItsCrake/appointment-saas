/**
 * Where this deployment actually lives.
 *
 * Deliberately pure and free of `next/headers`, so the same rule runs in a
 * server component, in a client component and in a unit test. Callers supply
 * the runtime origin they can see: a server page reads it from the request
 * headers, a client component from `window.location.origin`.
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(:\d+)?$/i;

export function normaliseOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** True for an origin nobody outside this machine can open. */
export function isLocalOrigin(value: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(value).host);
  } catch {
    return false;
  }
}

/**
 * Picks the origin a tenant's shareable link should use.
 *
 * `NEXT_PUBLIC_APP_URL` wins, because it is the only value that is also correct
 * inside a notification email, where there is no request to inspect.
 *
 * **Except when it points at localhost and the request plainly does not.** That
 * combination is a misconfigured deploy, not an instruction, and honouring it
 * is what put `http://localhost:3000/[slug]` on a card a business owner handed
 * to a customer. A link that cannot be opened is worse than one built from a
 * host header we merely inferred.
 */
export function pickAppUrl(
  configured: string | null | undefined,
  runtimeOrigin: string | null | undefined,
): string {
  const env = configured ? normaliseOrigin(configured) : "";
  const runtime = runtimeOrigin ? normaliseOrigin(runtimeOrigin) : "";

  if (!env) return runtime || "http://localhost:3000";
  if (runtime && isLocalOrigin(env) && !isLocalOrigin(runtime)) return runtime;
  return env;
}

/** The configured origin, or null when unset or blank. */
export function configuredAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return raw ? normaliseOrigin(raw) : null;
}

/**
 * Rebuilds an origin from proxy headers. Vercel sets the `x-forwarded-*` pair;
 * `host` is the fallback for everything else.
 */
export function originFromHeaders(
  get: (name: string) => string | null,
): string | null {
  const host = get("x-forwarded-host") ?? get("host");
  if (!host) return null;

  const proto =
    get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (LOCAL_HOST.test(host) ? "http" : "https");

  return `${proto}://${host}`;
}

/** Client-side counterpart. `window` is absent during SSR, hence the guard. */
export function browserOrigin(): string | null {
  return typeof window === "undefined" ? null : window.location.origin;
}

/** The public booking URL for a tenant. */
export function bookingUrlFor(appUrl: string, slug: string): string {
  return `${normaliseOrigin(appUrl)}/${slug}`;
}

/**
 * The origin an **emailed auth link** must come back to.
 *
 * Deliberately *not* `pickAppUrl`. That function exists to rescue a share link
 * from a stale `NEXT_PUBLIC_APP_URL` by falling back to the origin the request
 * arrived on, which is right for a link an owner hands to a customer and wrong
 * for this, twice over:
 *
 * 1. **Supabase only honours a `redirect_to` on its Redirect URLs allow-list.**
 *    That list is configured against the canonical domain. A request-derived
 *    origin — a Vercel preview URL, a bare IP, anything behind a different
 *    proxy — is not on it, so Supabase silently discards the destination and
 *    sends the user to the project's Site URL instead. The reported symptom of
 *    "the reset link lands on the home page" is exactly that fallback.
 * 2. **The origin comes from a request header.** Building a password-reset link
 *    out of `Host`/`x-forwarded-host` is the classic reset-poisoning shape: an
 *    attacker triggers a reset for someone else's address with a forged header,
 *    and the victim receives a genuine email whose link points at the
 *    attacker's host, handing over the token on click. Supabase's allow-list
 *    happens to blunt this, but a defence that only works because a third party
 *    is configured correctly is not a defence worth relying on.
 *
 * So the configured origin wins outright, and there is no promotion path from a
 * header to an emailed link. `runtimeOrigin` is used only when nothing is
 * configured at all — a local-development convenience, and the caller reports
 * it, because `check:env --production` already refuses to deploy without the
 * variable set to a non-localhost value.
 */
export function authRedirectOrigin(
  configured: string | null | undefined,
  runtimeOrigin: string | null | undefined,
): { origin: string; fromRequestHeader: boolean } {
  const env = configured ? normaliseOrigin(configured) : "";
  if (env) return { origin: env, fromRequestHeader: false };

  const runtime = runtimeOrigin ? normaliseOrigin(runtimeOrigin) : "";
  return {
    origin: runtime || "http://localhost:3000",
    fromRequestHeader: true,
  };
}
