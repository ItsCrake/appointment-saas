import { describe, expect, it } from "vitest";

import { planReminder } from "./reminder-policy";
import type { AppointmentContext } from "./types";
import {
  leadHoursFor,
  reminderTemplateFor,
  templateParameters,
  whatsappTemplateFor,
  WHATSAPP_TEMPLATES,
} from "./whatsapp-templates";

const HOUR = 3_600_000;

const context = (
  overrides: Partial<AppointmentContext> = {},
): AppointmentContext => ({
  kind: "booking_confirmation",
  businessName: "מספרת בלאק",
  businessPhone: "03-1234567",
  businessAddress: "הרצל 10, תל אביב",
  businessTimezone: "Asia/Jerusalem",
  bookingUrl: "https://bazman.app/demo-barber",
  manageUrl: "https://bazman.app/b/tok123",
  clientName: "דני",
  serviceName: "תספורת גבר",
  priceCents: 7000,
  startsAt: "2026-08-20T11:30:00.000Z",
  status: "confirmed",
  ...overrides,
});

describe("template selection", () => {
  it("sends the confirmation template on booking", () => {
    expect(whatsappTemplateFor(context())?.name).toBe(
      "appointment_confirmation",
    );
  });

  it("picks the reminder template from the lead time", () => {
    const reminder = context({ kind: "reminder" });
    expect(whatsappTemplateFor(reminder, { leadHours: 24 })?.name).toBe(
      "reminder_24h",
    );
    expect(whatsappTemplateFor(reminder, { leadHours: 2 })?.name).toBe(
      "reminder_2h",
    );
  });

  /**
   * The case that would otherwise send copy contradicting its own timing: a
   * tenant on `reminder_hours_before = 48` gets a reminder two days out, and
   * `reminder_24h` says tomorrow. No approved template fits, so there is none.
   */
  it("refuses a lead time neither approved template covers", () => {
    const reminder = context({ kind: "reminder" });
    for (const lead of [1, 3, 12, 36, 48, 72]) {
      expect(whatsappTemplateFor(reminder, { leadHours: lead })).toBeNull();
    }
    expect(reminderTemplateFor(undefined)).toBeNull();
  });

  it("has no template for kinds Meta never approved", () => {
    // Not an oversight: only three were approved. On the official API these
    // fall through to SMS or email rather than being dropped by Meta.
    for (const kind of [
      "booking_pending",
      "booking_approved",
      "booking_rejected",
      "cancellation_confirmation",
      "client_winback",
    ] as const) {
      expect(whatsappTemplateFor(context({ kind }))).toBeNull();
    }
  });

  it("has no template for a billing message", () => {
    // Billing addresses the owner and carries no appointment at all.
    expect(
      whatsappTemplateFor({
        kind: "trial_ending",
        businessName: "מספרת בלאק",
        businessTimezone: "Asia/Jerusalem",
        billingUrl: "https://bazman.app/dashboard/billing",
        planName: "מקצועי",
      }),
    ).toBeNull();
  });
});

describe("template parameters", () => {
  /**
   * Meta numbers body variables `{{1}}`…`{{5}}` and the numbering is frozen at
   * approval. Reordering this array silently reorders the sentence a client
   * reads, so the order is pinned here rather than left to review.
   */
  it("fills the five slots in the approved order", () => {
    const [name, business, when, location, manage] =
      templateParameters(context());

    expect(name).toBe("דני");
    expect(business).toBe("מספרת בלאק");
    expect(when).toContain("14:30"); // 11:30Z in Asia/Jerusalem, summer
    expect(when).toContain("20");
    expect(location).toBe("הרצל 10, תל אביב");
    expect(manage).toBe("https://bazman.app/b/tok123");
  });

  /**
   * The Cloud API rejects an empty body parameter outright, so a shop with no
   * address would have every templated message fail rather than arrive without
   * a location.
   */
  it("substitutes a placeholder rather than an empty string", () => {
    const params = templateParameters(
      context({ businessAddress: null, clientName: "  " }),
    );
    expect(params).not.toContain("");
    expect(params[0]).toBe("—");
    expect(params[3]).toBe("—");
  });

  it("gives every template the same five parameters", () => {
    // One substitution list across all three is what stops the reminder and the
    // confirmation drifting into disagreeing about how a date is written.
    const reminder = context({ kind: "reminder" });
    expect(whatsappTemplateFor(reminder, { leadHours: 2 })?.parameters).toEqual(
      whatsappTemplateFor(context())?.parameters,
    );
  });

  it("declares the three approved names and no others", () => {
    expect([...WHATSAPP_TEMPLATES]).toEqual([
      "appointment_confirmation",
      "reminder_24h",
      "reminder_2h",
    ]);
  });
});

describe("leadHoursFor", () => {
  it("recovers the lead from the two columns that decide it", () => {
    const startsAt = new Date("2026-08-20T14:00:00Z");
    expect(
      leadHoursFor(startsAt, new Date(startsAt.getTime() - 24 * HOUR)),
    ).toBe(24);
    expect(
      leadHoursFor(startsAt, new Date(startsAt.getTime() - 2 * HOUR)),
    ).toBe(2);
  });
});

/**
 * The scheduling condition the specification states, from both sides of the
 * boundary — and then joined to the template it selects, because the two are
 * one rule split across two modules.
 */
describe("booking lead time decides which reminder is scheduled", () => {
  const startsAt = new Date("2026-08-20T14:00:00Z");
  const bookedAt = (hoursAhead: number) =>
    new Date(startsAt.getTime() - hoursAhead * HOUR);

  const plan = (hoursAhead: number) =>
    planReminder({
      startsAt,
      bookedAt: bookedAt(hoursAhead),
      reminderHoursBefore: 24,
    });

  it("schedules the 24h reminder when booked more than 24h ahead", () => {
    for (const lead of [25, 30, 48, 24 * 7]) {
      const result = plan(lead);
      expect(result?.hoursBefore).toBe(24);
      expect(reminderTemplateFor(result?.hoursBefore)).toBe("reminder_24h");
      // And it lands exactly 24 hours before the appointment.
      expect(result?.sendAt.getTime()).toBe(startsAt.getTime() - 24 * HOUR);
    }
  });

  it("schedules the 2h reminder when booked less than 24h ahead", () => {
    for (const lead of [23, 12, 6, 3] as const) {
      const result = plan(lead);
      expect(result?.hoursBefore).toBe(2);
      expect(reminderTemplateFor(result?.hoursBefore)).toBe("reminder_2h");
      expect(result?.sendAt.getTime()).toBe(startsAt.getTime() - 2 * HOUR);
    }
  });

  /**
   * Exactly 24 hours is the boundary, and it resolves to nothing rather than to
   * either template. The long rule matches on `>=`, and its send time then
   * lands precisely on the booking instant — which `planReminder` discards,
   * because a reminder arriving with the confirmation is not a reminder. That
   * is what makes the spec's "more than 24 hours" true without a special case.
   */
  it("sends nothing when booked exactly 24h ahead", () => {
    expect(plan(24)).toBeNull();
  });

  it("sends nothing when the 2h window has already passed", () => {
    // Booked 90 minutes out: the two-hour reminder is already in the past, and
    // enqueuing it would fire on the next sweep, seconds after the confirmation.
    expect(plan(1.5)).toBeNull();
  });

  /**
   * The consequence of moving the boundary from 30h to 24h, pinned so it is a
   * known trade rather than a surprise: a booking made 25 hours ahead is
   * reminded one hour later.
   */
  it("reminds a 25h-ahead booking only an hour after it was made", () => {
    const result = plan(25);
    const gap = (result!.sendAt.getTime() - bookedAt(25).getTime()) / HOUR;
    expect(gap).toBe(1);
  });

  it("still honours a tenant's own longer lead", () => {
    // 48h preferred: the long rule takes the tenant's value, and no approved
    // template covers it — so WhatsApp routes elsewhere while the reminder
    // itself is still scheduled.
    const result = planReminder({
      startsAt,
      bookedAt: bookedAt(72),
      reminderHoursBefore: 48,
    });

    expect(result?.hoursBefore).toBe(48);
    expect(reminderTemplateFor(result?.hoursBefore)).toBeNull();
  });

  it("sends nothing at all when the tenant switched reminders off", () => {
    expect(
      planReminder({
        startsAt,
        bookedAt: bookedAt(48),
        reminderHoursBefore: 0,
      }),
    ).toBeNull();
  });
});
