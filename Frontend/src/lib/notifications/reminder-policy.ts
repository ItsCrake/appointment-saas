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
 * | Booked this far ahead | Reminder goes out |
 * | --------------------- | ----------------- |
 * | 30h or more           | 24h before        |
 * | less than 30h         | 2h before         |
 *
 * **The brief specified `>30h → 24h` and `<24h → 2h`, which leaves 24–30h
 * undefined.** Rules are therefore expressed as ordered thresholds and matched
 * longest-first, so every possible lead time hits exactly one — a gap in a
 * table like this does not fail loudly, it silently sends nothing.
 *
 * The 24–30h band resolves to the 2h rule on purpose. A booking made 26 hours
 * ahead would otherwise be reminded two hours after it was made, which reads as
 * a duplicate confirmation rather than a reminder.
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
  { minLeadHours: 30, hoursBefore: 24 },
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
