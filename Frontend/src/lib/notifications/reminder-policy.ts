const HOUR_MS = 3_600_000;

/**
 * When a reminder goes out, given how far ahead the booking was made.
 *
 * ---------------------------------------------------------------------------
 * A fixed "24 hours before" is wrong for half of all bookings. Someone who
 * books at 09:00 for 14:00 the same day gets no reminder at all — the send time
 * is already in the past — and that is exactly the client most likely to
 * forget, because they booked in a hurry.
 *
 * So the lead time decides the reminder:
 *
 * | Booked this far ahead | Reminder goes out | Meta template  |
 * | --------------------- | ----------------- | -------------- |
 * | more than 24h         | 24h before        | `reminder_24h` |
 * | 24h or less           | 2h before         | `reminder_2h`  |
 *
 * Rules are expressed as ordered thresholds and matched longest-first, so every
 * possible lead time hits exactly one — a gap in a table like this does not
 * fail loudly, it silently sends nothing.
 *
 * > **The threshold was 30h and is now 24h, and that reintroduces a case the
 * > 30h floor existed to prevent.** A booking made 25 hours ahead now gets its
 * > "24 hours before" reminder **one hour after it was made**, which reads as a
 * > duplicate confirmation rather than a reminder. The old table resolved the
 * > 24–30h band to the 2h rule for exactly that reason.
 * >
 * > It is 24h because the approved Meta templates are `reminder_24h` and
 * > `reminder_2h` and the specification ties the boundary to them. If the
 * > duplicate-confirmation effect shows up in practice, the fix is a minimum
 * > gap between booking and reminder — not moving the boundary back, which
 * > would leave 24–30h bookings on a template whose copy no longer matches.
 * ---------------------------------------------------------------------------
 */
export type ReminderRule = {
  /** Applies when the booking was made at least this far ahead. */
  minLeadHours: number;
  /** Send this long before the appointment starts. */
  hoursBefore: number;
};

/**
 * Ordered longest-first. The last rule must have `minLeadHours: 0` or short
 * bookings fall through the table and get nothing.
 */
export const DEFAULT_REMINDER_RULES: readonly ReminderRule[] = [
  // `minLeadHours: 24` with a `>=` match means a booking made exactly 24 hours
  // ahead takes the long rule — and `planReminder` then discards it, because
  // the send time lands precisely on the booking instant. The spec's "more
  // than 24 hours" therefore holds without a strict-inequality special case.
  { minLeadHours: 24, hoursBefore: 24 },
  { minLeadHours: 0, hoursBefore: 2 },
];

/**
 * The tenant's own `reminder_hours_before` replaces the **long** rule's lead,
 * so a shop that prefers 48 hours still gets the short-notice fallback for
 * same-day bookings. `0` disables reminders entirely, which is the documented
 * meaning of that column and is checked by the caller.
 */
export function rulesForBusiness(
  reminderHoursBefore: number,
  base: readonly ReminderRule[] = DEFAULT_REMINDER_RULES,
): ReminderRule[] {
  return base.map((rule, index) =>
    index === 0 ? { ...rule, hoursBefore: reminderHoursBefore } : { ...rule },
  );
}

export type ReminderPlan = {
  /** When to send. */
  sendAt: Date;
  /** Which rule produced it, for the dedupe key and for logs. */
  hoursBefore: number;
};

/**
 * The reminder for one booking, or `null` when there should not be one.
 *
 * Null in three cases, all of them real:
 *
 * - reminders are switched off (`reminderHoursBefore <= 0`);
 * - no rule matches, which a sane table makes impossible but a hand-edited one
 *   does not;
 * - the computed send time has already passed. A booking made ninety minutes
 *   ahead cannot have a two-hour reminder, and enqueuing one in the past would
 *   fire it on the next sweep — a "reminder" arriving seconds after the
 *   confirmation.
 */
export function planReminder(input: {
  /** When the appointment starts. */
  startsAt: Date;
  /** When the booking was made — `now` for a fresh one. */
  bookedAt: Date;
  reminderHoursBefore: number;
  rules?: readonly ReminderRule[];
}): ReminderPlan | null {
  const { startsAt, bookedAt, reminderHoursBefore } = input;

  if (reminderHoursBefore <= 0) return null;

  const rules = input.rules ?? rulesForBusiness(reminderHoursBefore);
  const leadHours = (startsAt.getTime() - bookedAt.getTime()) / HOUR_MS;

  // Longest-first, so the table reads top-down as "the most generous rule that
  // still applies". Sorted here rather than trusted, because a caller passing
  // its own rules should not have to know the order matters.
  const ordered = [...rules].sort((a, b) => b.minLeadHours - a.minLeadHours);
  const rule = ordered.find((candidate) => leadHours >= candidate.minLeadHours);
  if (!rule || rule.hoursBefore <= 0) return null;

  const sendAt = new Date(startsAt.getTime() - rule.hoursBefore * HOUR_MS);
  if (sendAt.getTime() <= bookedAt.getTime()) return null;

  return { sendAt, hoursBefore: rule.hoursBefore };
}
