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
