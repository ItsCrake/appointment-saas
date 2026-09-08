/**
 * Which route a booking arrived by.
 *
 * ---------------------------------------------------------------------------
 * **Coerced rather than trusted, like every other stored preference here.** The
 * column has a default and a `text` type, so a row written by a migration, a
 * script or a future path can hold anything; a card that has to render it must
 * get a value it knows rather than a blank badge or a crash.
 *
 * Kept out of `db/schema.ts` so a client component can import the type and the
 * icon mapping without pulling the schema — and out of `libi-*` because a
 * manual booking is not ליבי's business.
 * ---------------------------------------------------------------------------
 */

export const APPOINTMENT_ORIGINS = ["online", "manual", "voice"] as const;

export type AppointmentOrigin = (typeof APPOINTMENT_ORIGINS)[number];

/**
 * `'online'` is the default because it is what every row predating the column
 * is, and because it is the one origin that needs no mark on the card: a client
 * booking themselves is the ordinary case this product exists for.
 */
export const DEFAULT_ORIGIN: AppointmentOrigin = "online";

export function appointmentOrigin(
  value: string | null | undefined,
): AppointmentOrigin {
  const wanted = value?.trim().toLowerCase();
  return (APPOINTMENT_ORIGINS as readonly string[]).includes(wanted ?? "")
    ? (wanted as AppointmentOrigin)
    : DEFAULT_ORIGIN;
}

/**
 * Whether this origin earns a mark on the calendar card.
 *
 * Only voice, deliberately. A badge on every card is wallpaper — the eye stops
 * reading it by the second row — and the question an owner actually has is
 * "did ליבי put that there", not "which of three routes was this".
 */
export function marksTheCard(origin: AppointmentOrigin): boolean {
  return origin === "voice";
}
