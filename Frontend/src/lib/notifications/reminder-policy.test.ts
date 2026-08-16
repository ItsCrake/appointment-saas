import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_RULES,
  planReminder,
  rulesForBusiness,
} from "@/lib/notifications/reminder-policy";

const START = new Date("2026-08-10T12:00:00Z");

/** A booking made `hours` before the appointment. */
const bookedAhead = (hours: number) =>
  new Date(START.getTime() - hours * 3_600_000);

const plan = (leadHours: number, reminderHoursBefore = 24) =>
  planReminder({
    startsAt: START,
    bookedAt: bookedAhead(leadHours),
    reminderHoursBefore,
  });

describe("planReminder", () => {
  it("reminds a day before when the booking was made well in advance", () => {
    const result = plan(72);

    expect(result?.hoursBefore).toBe(24);
    expect(result?.sendAt.toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });

  it("reminds two hours before a short-notice booking", () => {
    // The case a fixed 24-hour rule loses entirely: 24 hours before is already
    // in the past, so the client most likely to forget got nothing.
    const result = plan(6);

    expect(result?.hoursBefore).toBe(2);
    expect(result?.sendAt.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });

  /**
   * The boundary moved from 30h to 24h when the Meta templates landed, because
   * the approved copy is `reminder_24h` / `reminder_2h` and the scheduling rule
   * is now tied to those names.
   *
   * The 24–30h band therefore changed sides: it used to take the 2h rule, and
   * now takes the 24h one. That is the trade the move makes — see the note in
   * `reminder-policy.ts` and the gap assertion below.
   */
  it("gives the 24–30h band the long rule now, not the short one", () => {
    for (const lead of [25, 26, 29.9]) {
      const result = plan(lead);
      expect(result).not.toBeNull();
      expect(result?.hoursBefore).toBe(24);
    }
  });

  it("switches rules exactly at the threshold", () => {
    expect(plan(24.01)?.hoursBefore).toBe(24);
    expect(plan(23.99)?.hoursBefore).toBe(2);
  });

  it("sends nothing at exactly 24h, where the reminder would land on the booking", () => {
    // The long rule matches (`>=`), then its send time lands precisely on the
    // booking instant and is discarded. This is what makes the specification's
    // "more than 24 hours" hold without a strict-inequality special case.
    expect(plan(24)).toBeNull();
  });

  /**
   * The cost of the move, pinned so it stays a known trade. Under the old 30h
   * floor this booking got a 2h reminder; it now gets its "24 hours before"
   * reminder one hour after it was made.
   */
  it("reminds a 25h-ahead booking an hour after it was made", () => {
    const result = plan(25);
    const gapMs = result!.sendAt.getTime() - bookedAhead(25).getTime();
    expect(gapMs / 3_600_000).toBe(1);
  });

  it("sends nothing when reminders are switched off", () => {
    // `0` is the documented meaning of the column, not a missing value.
    expect(plan(72, 0)).toBeNull();
    expect(plan(6, 0)).toBeNull();
  });

  it("sends nothing when even the short rule would land in the past", () => {
    // Booked ninety minutes ahead: a two-hour reminder would fire before the
    // booking existed, and enqueuing it would produce a "reminder" arriving
    // seconds after the confirmation.
    expect(plan(1.5)).toBeNull();
    expect(plan(2)).toBeNull();
  });

  it("honours the tenant's own lead for the long rule", () => {
    // A shop that prefers 48 hours keeps 48 for advance bookings...
    expect(plan(96, 48)?.hoursBefore).toBe(48);
    // ...and still gets the short-notice fallback for a same-day one.
    expect(plan(5, 48)?.hoursBefore).toBe(2);
  });

  it("matches longest-first regardless of the order rules are given in", () => {
    // A caller passing its own table should not have to know order matters.
    const shuffled = [
      { minLeadHours: 0, hoursBefore: 2 },
      { minLeadHours: 30, hoursBefore: 24 },
    ];

    const result = planReminder({
      startsAt: START,
      bookedAt: bookedAhead(72),
      reminderHoursBefore: 24,
      rules: shuffled,
    });

    expect(result?.hoursBefore).toBe(24);
  });

  it("takes a fully custom table", () => {
    // "Fully configurable" means the thresholds too, not only the leads.
    const result = planReminder({
      startsAt: START,
      bookedAt: bookedAhead(10),
      reminderHoursBefore: 24,
      rules: [
        { minLeadHours: 8, hoursBefore: 4 },
        { minLeadHours: 0, hoursBefore: 1 },
      ],
    });

    expect(result?.hoursBefore).toBe(4);
  });

  it("returns null rather than throwing when no rule matches", () => {
    // A hand-edited table with no zero-floor rule is the realistic way this
    // happens, and silently sending nothing is better than a crash in a sweep.
    const result = planReminder({
      startsAt: START,
      bookedAt: bookedAhead(1),
      reminderHoursBefore: 24,
      rules: [{ minLeadHours: 48, hoursBefore: 24 }],
    });

    expect(result).toBeNull();
  });
});

describe("rulesForBusiness", () => {
  it("replaces the long rule's lead and leaves the fallback alone", () => {
    const rules = rulesForBusiness(48);

    expect(rules[0]).toEqual({ minLeadHours: 24, hoursBefore: 48 });
    expect(rules[1]).toEqual({ minLeadHours: 0, hoursBefore: 2 });
  });

  it("does not mutate the shared default table", () => {
    rulesForBusiness(48);
    expect(DEFAULT_REMINDER_RULES[0].hoursBefore).toBe(24);
  });

  it("ends with a rule that every lead time satisfies", () => {
    // Without a zero floor, short bookings fall through and get nothing.
    const last = DEFAULT_REMINDER_RULES[DEFAULT_REMINDER_RULES.length - 1];
    expect(last.minLeadHours).toBe(0);
  });
});
