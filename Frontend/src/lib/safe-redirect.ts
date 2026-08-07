/**
 * Open-redirect guard for any path that arrives in a query string.
 *
 * Pure and free of `next/*`, so the same rule runs in a server action, in a
 * route handler and in a test.
 *
 * This matters most on the recovery link. `/auth/confirm` establishes a real
 * session and *then* redirects, so an unchecked `next` would hand an attacker a
 * link that authenticates the victim and drops them on a page the attacker
 * chose — with the referrer, and on a domain the owner has been taught to
 * trust. The link itself is genuine, which is what makes it convincing.
 */

/** Control characters can truncate — or forge — the `Location` header. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Rejects anything that could leave this origin. */
export function isSafeRedirectPath(value: string): boolean {
  // Must be an absolute path on this host.
  if (!value.startsWith("/")) return false;

  // `//evil.com` is protocol-relative: a browser reads it as another origin.
  if (value.startsWith("//")) return false;

  // Browsers normalise a backslash to a forward slash in the authority, so
  // `/\evil.com` escapes the origin on some of them.
  if (value.includes("\\")) return false;

  if (hasControlCharacter(value)) return false;

  return true;
}

/**
 * The requested path when it is safe, otherwise the fallback.
 *
 * `prefix` narrows it further for callers that know where the journey must
 * land — sign-in only ever returns someone to the dashboard, so accepting an
 * arbitrary in-app path there would be wider than the feature needs.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string,
  prefix?: string,
): string {
  if (!value) return fallback;
  if (!isSafeRedirectPath(value)) return fallback;
  if (prefix && !value.startsWith(prefix)) return fallback;
  return value;
}
