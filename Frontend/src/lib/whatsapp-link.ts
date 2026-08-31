import { normalizePhone } from "./validation";

/**
 * A `wa.me` link for a client's stored number.
 *
 * ---------------------------------------------------------------------------
 * **One rule, in one place.** This is the third thing in the codebase that had
 * to turn a phone number into an international one, after `normalizePhone`
 * (which writes the stored `05…` form) and `toE164` (which feeds Meta and
 * Twilio). The third was written inline in `waitlist-manager` — strip
 * non-digits, swap a leading `0` for `972` — and inline is exactly where a rule
 * goes to drift: a number typed as `+972…` normalises correctly through one
 * path and not the other, and the failure is a WhatsApp link that opens a chat
 * with nobody.
 *
 * Composed **on top of** `normalizePhone` rather than beside it, which is what
 * keeps them from disagreeing: whatever the owner or the booking form typed is
 * reduced to the one stored form first, and only then made international.
 *
 * `wa.me` wants bare digits with no `+`, which is why this is not simply
 * `toE164` with the plus stripped — that would be a second conversion of the
 * same value, and the point is that there is only one.
 * ---------------------------------------------------------------------------
 */
const DEFAULT_COUNTRY = "972";

/**
 * Returns the link, or `null` when there is nothing dialable.
 *
 * Null rather than a broken href: a booking can carry a blank or junk phone —
 * the manual-booking form allows one, deliberately, because a walk-in without a
 * number is still a booking — and a WhatsApp button that opens an error page is
 * worse than no button.
 */
export function whatsappHref(
  phone: string | null | undefined,
  country = DEFAULT_COUNTRY,
): string | null {
  if (!phone) return null;

  const local = normalizePhone(phone);
  if (local.length < 7) return null;

  /**
   * A leading `0` is a national trunk code and is replaced, never kept.
   * Anything else is already international — `normalizePhone` only produces a
   * leading zero for numbers it recognised as local — so it is passed through
   * rather than having a country code stapled onto the front of one it already
   * has.
   */
  const international = local.startsWith("0")
    ? `${country}${local.slice(1)}`
    : local;

  return `https://wa.me/${international}`;
}
