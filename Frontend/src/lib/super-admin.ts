/**
 * Platform-owner access for `/master`.
 *
 * The brief offered `is_super_admin = true` on a table as an alternative. That
 * does not fit this schema: super-admin is a property of a *user*, and users
 * live in Supabase's `auth.users`, which this app does not own and must not
 * add columns to. `businesses` is the wrong home — an owner can have several,
 * and a platform admin may own none.
 *
 * So the roster is an env list. It is deploy-time configuration rather than
 * data, which also means promoting someone requires a deploy — deliberate, for
 * a role that can read every tenant's client list.
 */
export const SUPER_ADMIN_ENV = "SUPER_ADMIN_EMAILS";

/** Comma-separated, case- and whitespace-insensitive. */
export function parseSuperAdmins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * An empty roster denies everyone. Failing closed matters more here than
 * convenience: a missing or misspelled env var must not open the platform
 * console to the first person who signs up.
 */
export function isSuperAdminEmail(
  email: string | null | undefined,
  raw: string | undefined,
): boolean {
  if (!email) return false;
  const roster = parseSuperAdmins(raw);
  if (roster.length === 0) return false;
  return roster.includes(email.trim().toLowerCase());
}
