/**
 * Coercions for values a raw `sql` template hands back.
 *
 * ---------------------------------------------------------------------------
 * **A bare `sql` fragment has no declared column type, so postgres.js returns
 * the value as the raw string Postgres sent** — `"2026-08-04 12:44:56.938+00"`
 * for a timestamp — while the TypeScript annotation on it cheerfully claims
 * `Date`. PGlite parses the same value into a `Date`, so the suite proves the
 * opposite of production. This is the driver gap ARCHITECTURE.md documents for
 * *binding*, seen from the reading side.
 *
 * It is not theoretical. It took `/master/alerts` down:
 * `Intl.DateTimeFormat.format()` coerces its argument with `ToNumber`, a date
 * string becomes `NaN`, and the render threw `RangeError: Invalid time value`
 * — which reaches the browser as an error digest and a blank page. The guard in
 * front of it checked truthiness, and a non-empty string is perfectly truthy.
 *
 * > `.mapWith()` looks like the tidy fix and **does not work here** — the
 * > mapper is not applied to a `sql` selection in this position, which the
 * > clients-directory tests demonstrated by failing on
 * > `lastVisit.toISOString is not a function`. Converting at the boundary,
 * > where the rows are returned, is the thing that actually runs.
 * ---------------------------------------------------------------------------
 */

/** A `Date`, or null for anything that is not a usable timestamp. */
export function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
