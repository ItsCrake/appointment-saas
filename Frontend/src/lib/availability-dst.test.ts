import { describe, expect, it } from "vitest";

import {
  computeSlots,
  type AvailabilityBusiness,
  type ComputeSlotsInput,
} from "@/lib/availability";
import { planReminder } from "@/lib/notifications/reminder-policy";
import { entryMatchesSlot, localSlotFacts } from "@/lib/waitlist";

/**
 * Israel changes its clocks twice a year, and nothing in this suite used to
 * look at either day.
 *
 * ---------------------------------------------------------------------------
 * **The exact 2026 transitions**, verified against the platform's own tz
 * database rather than derived from the rule:
 *
 * | Transition     | UTC instant            | Local effect                    |
 * | -------------- | ---------------------- | ------------------------------- |
 * | spring forward | `2026-03-27T00:00:00Z` | 02:00 → 03:00; **01:59 jumps to 03:00**, so local 02:00–02:59 does not exist on 27 March |
 * | fall back      | `2026-10-24T23:00:00Z` | 02:00 → 01:00; **local 01:00–01:59 happens twice** on 25 October |
 *
 * Both are Friday-into-Saturday and Saturday-into-Sunday respectively — which
 * is to say they land on the Israeli weekend, when most of these shops are
 * shut. That is why this has not bitten yet, and it is exactly why it is worth
 * pinning: the failure would appear on one specific day, at one specific shop
 * that happens to open early, and would look like a mystery.
 *
 * Everything here is pure. `computeSlots`, `planReminder` and the waitlist
 * matcher all take their clock as an argument, so these are assertions rather
 * than tests that behave differently depending on when CI runs.
 * ---------------------------------------------------------------------------
 */

const TZ = "Asia/Jerusalem";

const SPRING_FORWARD = "2026-03-27";
const FALL_BACK = "2026-10-25";

const business: AvailabilityBusiness = {
  timezone: TZ,
  slotIntervalMin: 15,
  bufferMin: 0,
  minNoticeMin: 0,
  maxAdvanceDays: 365,
};

/** A day's slots, with everything not under test held still. */
function slotsFor(
  date: string,
  shifts: { startTime: string; endTime: string }[],
  overrides: Partial<ComputeSlotsInput> = {},
) {
  return computeSlots({
    business,
    durationMin: 60,
    shifts: shifts.map((s) => ({ ...s, isClosed: false })),
    appointments: [],
    timeOff: [],
    date,
    // Long before either transition, so `minNoticeMin` and `maxAdvanceDays`
    // never trim the day and the assertions are about the clock alone.
    now: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  });
}

describe("an ordinary working day across a clock change", () => {
  it("puts a 09:00 start at 06:00Z on the spring-forward day", () => {
    // The transition is at 02:00, long before the shop opens, so the whole
    // working day is already +03:00. The offset is the assertion: a naive
    // implementation that cached the previous day's +02:00 would place this
    // an hour late and every client would arrive an hour after their slot.
    const slots = slotsFor(SPRING_FORWARD, [
      { startTime: "09:00:00", endTime: "17:00:00" },
    ]);

    expect(slots[0].startsAt).toBe("2026-03-27T06:00:00.000Z");
    expect(slots[0].label).toBe("09:00");
    expect(slots).toHaveLength(8);
  });

  it("puts a 09:00 start at 07:00Z on the fall-back day", () => {
    // Same shop, same wall clock, one hour later in UTC — because by 09:00 on
    // 25 October the clocks have already gone back to +02:00.
    const slots = slotsFor(FALL_BACK, [
      { startTime: "09:00:00", endTime: "17:00:00" },
    ]);

    expect(slots[0].startsAt).toBe("2026-10-25T07:00:00.000Z");
    expect(slots[0].label).toBe("09:00");
    expect(slots).toHaveLength(8);
  });

  it("gives the same shop the same number of slots on both days", () => {
    // The day either side of a transition is still eight hours of work. This
    // is the regression that matters most: a shop losing or gaining an hour of
    // bookable time twice a year, silently.
    const spring = slotsFor(SPRING_FORWARD, [
      { startTime: "09:00:00", endTime: "17:00:00" },
    ]);
    const autumn = slotsFor(FALL_BACK, [
      { startTime: "09:00:00", endTime: "17:00:00" },
    ]);

    expect(spring).toHaveLength(autumn.length);
    expect(spring.map((s) => s.label)).toEqual(autumn.map((s) => s.label));
  });
});

describe("the hour that does not exist", () => {
  /**
   * 02:00–02:59 on 27 March is not a time. A shift declared across it is
   * shorter in real seconds than it looks on paper, and the engine must not
   * offer a start inside the gap — an appointment at 02:30 that day could
   * never be kept.
   */
  it("loses an hour of real time from a shift that spans the gap", () => {
    const slots = slotsFor(SPRING_FORWARD, [
      { startTime: "01:00:00", endTime: "04:00:00" },
    ]);

    // Three wall-clock hours, two real ones: 01:00 (+02:00) is 23:00Z on the
    // 26th, and 04:00 (+03:00) is 01:00Z on the 27th.
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-03-26T23:00:00.000Z",
      "2026-03-27T00:00:00.000Z",
    ]);
  });

  it("never labels a slot inside the missing hour", () => {
    const slots = slotsFor(SPRING_FORWARD, [
      { startTime: "00:00:00", endTime: "06:00:00" },
    ]);

    // Whatever else it does, it must not claim 02:xx exists on this date.
    expect(slots.map((s) => s.label)).not.toContain("02:00");
    for (const slot of slots) {
      expect(slot.label.startsWith("02:")).toBe(false);
    }
  });
});

describe("the hour that happens twice", () => {
  /**
   * 01:00–01:59 on 25 October occurs once at +03:00 and again at +02:00. The
   * engine works in UTC instants, so both are genuinely bookable and genuinely
   * distinct — but `formatInTimeZone` renders them with the same label.
   */
  it("gains an hour of real time from a shift that spans the repeat", () => {
    const slots = slotsFor(FALL_BACK, [
      { startTime: "00:00:00", endTime: "04:00:00" },
    ]);

    // Four wall-clock hours, five real ones: 00:00 (+03:00) is 21:00Z on the
    // 24th, and 04:00 (+02:00) is 02:00Z on the 25th.
    expect(slots).toHaveLength(5);
    expect(slots[0].startsAt).toBe("2026-10-24T21:00:00.000Z");
    expect(slots[4].startsAt).toBe("2026-10-25T01:00:00.000Z");
  });

  it("produces two distinct instants that both render as 01:00", () => {
    /**
     * **Documented, not endorsed.** A client picking from this list sees the
     * same time twice with no way to tell them apart, and the one they mean is
     * a coin flip. It is safe today only because no shop in the pilot opens at
     * one in the morning.
     *
     * The fix, if a 24-hour venue ever signs up, is a disambiguating suffix on
     * the label for this one day — not a change to the instants, which are
     * correct. Asserted here so that whoever hits it finds the reasoning
     * instead of the symptom.
     */
    const slots = slotsFor(FALL_BACK, [
      { startTime: "00:00:00", endTime: "04:00:00" },
    ]);

    const ones = slots.filter((s) => s.label === "01:00");

    expect(ones).toHaveLength(2);
    expect(ones[0].startsAt).not.toBe(ones[1].startsAt);
    // Exactly one real hour apart, which is what makes them different slots.
    expect(
      new Date(ones[1].startsAt).getTime() -
        new Date(ones[0].startsAt).getTime(),
    ).toBe(3_600_000);
  });
});

describe("a reminder that crosses a transition", () => {
  it("stays twenty-four real hours, not twenty-four wall-clock hours", () => {
    /**
     * The appointment is at 10:00 local on the spring-forward day, which is
     * 07:00Z. Twenty-four hours earlier is 07:00Z on the 26th — but the 26th
     * is still +02:00, so it lands at **09:00** local, an hour "early" by the
     * clock on the wall.
     *
     * That is correct and deliberate: `planReminder` is arithmetic on UTC
     * instants, and a day is a day. It is pinned because it looks like a bug
     * in a support ticket, and the copy still holds — `reminder_24h` says
     * "מחר", which is true either way.
     */
    const startsAt = new Date("2026-03-27T07:00:00.000Z");

    const plan = planReminder({
      startsAt,
      bookedAt: new Date("2026-03-20T09:00:00.000Z"),
      reminderHoursBefore: 24,
    });

    expect(plan).not.toBeNull();
    expect(plan!.sendAt.toISOString()).toBe("2026-03-26T07:00:00.000Z");
    expect(startsAt.getTime() - plan!.sendAt.getTime()).toBe(24 * 3_600_000);
  });

  it("keeps the short rule exactly two hours across the fall-back", () => {
    // 03:00 local on 25 October is 01:00Z. Two hours before is 23:00Z on the
    // 24th, which is 01:00 local — the *second* 01:00. Still two real hours.
    const startsAt = new Date("2026-10-25T01:00:00.000Z");

    const plan = planReminder({
      startsAt,
      bookedAt: new Date("2026-10-24T20:00:00.000Z"),
      reminderHoursBefore: 24,
    });

    expect(plan).not.toBeNull();
    expect(plan!.hoursBefore).toBe(2);
    expect(startsAt.getTime() - plan!.sendAt.getTime()).toBe(2 * 3_600_000);
  });
});

describe("waitlist matching across a transition", () => {
  const entry = {
    status: "active",
    serviceId: null,
    preferredStaffId: null,
    preferredDays: [] as number[],
    preferredTimeWindow: "morning" as const,
  };

  const slot = (iso: string) => ({
    startsAt: new Date(iso),
    endsAt: new Date(new Date(iso).getTime() + 3_600_000),
    staffId: "staff-1",
    serviceId: "service-1",
  });

  it("reads the shop's wall clock, not a fixed offset", () => {
    /**
     * 09:30Z on 25 October is 11:30 local, because the clocks went back — a
     * morning slot. Anything that assumed a constant +03:00 would call it
     * 12:30 and classify it as afternoon, so a client who asked for mornings
     * would never hear about it.
     */
    const facts = localSlotFacts(slot("2026-10-25T09:30:00.000Z"), TZ);

    expect(facts.hour).toBe(11);
    expect(entryMatchesSlot(entry, slot("2026-10-25T09:30:00.000Z"), TZ)).toBe(
      true,
    );
  });

  it("classifies the same UTC instant differently either side of the change", () => {
    // The identical clock reading, one week apart, is a morning slot before
    // the change and an afternoon one after it. Both answers are right.
    const before = localSlotFacts(slot("2026-10-18T09:30:00.000Z"), TZ);
    const after = localSlotFacts(slot("2026-10-25T09:30:00.000Z"), TZ);

    expect(before.hour).toBe(12);
    expect(after.hour).toBe(11);

    const morning = { ...entry, preferredTimeWindow: "morning" as const };
    expect(
      entryMatchesSlot(morning, slot("2026-10-18T09:30:00.000Z"), TZ),
    ).toBe(false);
    expect(
      entryMatchesSlot(morning, slot("2026-10-25T09:30:00.000Z"), TZ),
    ).toBe(true);
  });

  it("matches the weekday the shop would call it", () => {
    // 21:00Z on 24 October is already Sunday 25th locally (+03:00), so a
    // client who asked for Sundays must match it and one who asked for
    // Saturdays must not.
    const overnight = slot("2026-10-24T21:00:00.000Z");

    expect(localSlotFacts(overnight, TZ).weekday).toBe(0);
    expect(
      entryMatchesSlot(
        { ...entry, preferredDays: [0], preferredTimeWindow: "any" },
        overnight,
        TZ,
      ),
    ).toBe(true);
    expect(
      entryMatchesSlot(
        { ...entry, preferredDays: [6], preferredTimeWindow: "any" },
        overnight,
        TZ,
      ),
    ).toBe(false);
  });
});
