/**
 * Online bookings paused by the owner (0035) — what the client is told.
 *
 * ---------------------------------------------------------------------------
 * **One sentence, shared by every refusal and by the page's own notice**, so a
 * client who reaches the refusal through a stale tab reads exactly what a client
 * who loaded the page fresh reads. It says what is true and no more: the shop
 * has paused booking on this page, and it is a pause. It does not say the shop
 * is closed, because it is not, and it does not promise a time, because nobody
 * has given one.
 *
 * Its own module with no imports, so the server actions, the booking flow and
 * the tests can all read it without dragging in the database.
 * ---------------------------------------------------------------------------
 */

/** The code a refusal carries, so the page can switch into its paused state. */
export const BOOKINGS_PAUSED_CODE = "BOOKINGS_PAUSED" as const;

/** Hebrew, like every server message; the showcase translates the notice. */
export const BOOKINGS_PAUSED_MESSAGE =
  "קביעת תורים אונליין מושהית כרגע על ידי העסק. נסו שוב בקרוב.";

/**
 * What the waitlist's claim link says instead of booking.
 *
 * The person holding it was offered a slot before the pause, and the claim
 * returns them to the queue rather than out of it — so the message says so.
 */
export const WAITLIST_PAUSED_MESSAGE =
  "העסק השהה זמנית את קביעת התורים אונליין. שמרנו לכם את המקום ברשימת ההמתנה.";
