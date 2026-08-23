import { describe, expect, it } from "vitest";

import { planReminder } from "./reminder-policy";
import type { AppointmentContext } from "./types";
import {
  anchorRtl,
  datePhrase,
  leadHoursFor,
  reminderTemplateFor,
  timePhrase,
  whatsappTemplateFor,
  WHATSAPP_TEMPLATES,
} from "./whatsapp-templates";

const HOUR = 3_600_000;

/** U+200F RIGHT-TO-LEFT MARK, spelled out so the tests below stay readable. */
const RLM = "‏";

/**
 * Drops the direction marks `anchorRtl` wraps around dates and times. They are
 * real content to Meta and whitespace to a reader, so assertions about what a
 * client *sees* compare the stripped form.
 */
const strip = (value: string) => value.replaceAll(RLM, "");

const TOKEN = "34e64171-cb3e-47b3-8548-82297eff1270";

const context = (
  overrides: Partial<AppointmentContext> = {},
): AppointmentContext => ({
  kind: "booking_confirmation",
  businessName: "מספרת בלאק",
  businessPhone: "03-1234567",
  businessAddress: "הרצל 10, תל אביב",
  businessTimezone: "Asia/Jerusalem",
  bookingUrl: "https://www.bazman.app/demo-barber",
  businessSlug: "demo-barber",
  manageUrl: `https://www.bazman.app/b/${TOKEN}`,
  manageToken: TOKEN,
  clientName: "דני",
  serviceName: "תספורת גבר",
  priceCents: 7000,
  // 14:30 on Thursday 20/08/2026 in Asia/Jerusalem — summer time.
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

  it("has no template for the kinds Meta still has not approved", () => {
    /**
     * `client_winback` is the last one outstanding, and the only client-facing
     * kind left with no template. It is **Marketing** rather than Utility, so
     * it carries obligations the other seven do not — a named sender and an
     * in-message opt-out — and is submitted separately.
     *
     * On the official path this is a *failed* send, not a fallback: the channel
     * was chosen at enqueue time and nothing re-routes it at dispatch.
     */
    expect(whatsappTemplateFor(context({ kind: "client_winback" }))).toBeNull();
  });

  it("resolves every kind that Meta has now approved", () => {
    // The four wired after the original three. A regression here means real
    // clients stop receiving these, and the failure is silent from the shop's
    // side — the owner sees a booking that worked.
    for (const kind of [
      "booking_pending",
      "booking_approved",
      "booking_rejected",
      "cancellation_confirmation",
    ] as const) {
      expect(whatsappTemplateFor(context({ kind }))).not.toBeNull();
    }
  });

  it("sends the Hebrew resubmissions under their _he names", () => {
    /**
     * The un-suffixed names are already taken on the Meta account by the
     * original **English** submissions, and a template name is unique per
     * account. Sending `booking_pending` would deliver the English template to
     * a Hebrew-speaking client — which is why this is pinned rather than
     * trusted to a comment.
     */
    expect(
      whatsappTemplateFor(context({ kind: "booking_pending" }))?.name,
    ).toBe("booking_pending_he");
    expect(
      whatsappTemplateFor(context({ kind: "cancellation_confirmation" }))?.name,
    ).toBe("cancellation_confirmation_he");
  });

  it("points the manage button at a whole path, not a bare token", () => {
    /**
     * The one thing that makes these unlike `appointment_confirmation`. That
     * template takes a bare token against the same base and leans on the root
     * redirect in `classifyPublicPath`; these were registered later and take
     * `b/<token>` directly. A bare token here lands the client on a shop page
     * named after a UUID.
     */
    const approved = whatsappTemplateFor(context({ kind: "booking_approved" }));
    expect(approved?.buttonUrlSuffix).toMatch(/^b\//);

    // ...while the two that offer a fresh booking take the slug instead.
    const rejected = whatsappTemplateFor(context({ kind: "booking_rejected" }));
    expect(rejected?.buttonUrlSuffix).toBe("demo-barber");
  });

  it("sends the weekday inside {{2}} for all four, not a bare date", () => {
    /**
     * This flipped once already. The Meta dashboard's *sample values* for these
     * four are bare dates ("17/06/2026"), which looked like a constraint and is
     * not one — the approved **body** puts 📅 beside `{{2}}` with no "ביום" of
     * its own, so a bare date renders as a date with no day beside a calendar
     * emoji.
     *
     * Pinned across all four rather than spot-checked, because they share one
     * code path and the next person to read a sample value will reach the same
     * wrong conclusion.
     */
    for (const kind of [
      "booking_pending",
      "booking_approved",
      "booking_rejected",
      "cancellation_confirmation",
    ] as const) {
      const template = whatsappTemplateFor(context({ kind }));
      const date = strip(template?.parameters[1] ?? "");

      expect(date).toBe("יום חמישי, 20/08/2026");
    }
  });

  it("omits the header only for the template that has none", () => {
    // Meta rejects a header parameter for a template with no header component,
    // so this is a property of the approved artifact rather than a preference.
    expect(
      whatsappTemplateFor(context({ kind: "cancellation_confirmation" }))
        ?.header,
    ).toBeUndefined();
    expect(
      whatsappTemplateFor(context({ kind: "booking_approved" }))?.header,
    ).toHaveLength(1);
  });

  it("has no template for a billing message", () => {
    // Billing addresses the owner and carries no appointment at all.
    expect(
      whatsappTemplateFor({
        kind: "trial_ending",
        businessName: "מספרת בלאק",
        businessTimezone: "Asia/Jerusalem",
        billingUrl: "https://www.bazman.app/dashboard/billing",
        planName: "מקצועי",
      }),
    ).toBeNull();
  });

  it("declares exactly the names registered on the Meta account", () => {
    // Eight templates, seven of which map to a kind — the two reminders share
    // `reminder` and split on lead time. Pinned because a name that does not
    // exist on the account is a rejected send, and a name that exists in the
    // wrong language is worse: it delivers.
    expect([...WHATSAPP_TEMPLATES]).toEqual([
      "appointment_confirmation",
      "reminder_24h",
      "reminder_2h",
      "booking_approved",
      "booking_rejected",
      "booking_pending_he",
      "cancellation_confirmation_he",
      "waitlist_invite",
    ]);
  });
});

/**
 * These three shapes are transcriptions of copy Meta has already approved, and
 * the numbering is frozen until it is resubmitted. Every assertion here is
 * therefore pinning an external fact rather than a preference — which is the
 * whole reason they are asserted instead of reviewed.
 */
describe("approved template shapes", () => {
  /**
   * The regression this file exists for.
   *
   * `appointment_confirmation` contains two `{{1}}` — one in the header, one in
   * the body — because Meta numbers each component from 1 independently. An
   * earlier version of this module sent one flat list of five parameters shared
   * across all three templates, which would have put the client's name where
   * the business name belongs and dropped the last two on the floor.
   */
  it("fills the confirmation's header and body from different values", () => {
    const template = whatsappTemplateFor(context())!;

    expect(template.header).toEqual(["דני"]);
    expect(template.parameters).toEqual([
      "מספרת בלאק",
      anchorRtl("יום חמישי, 20/08/2026"),
      anchorRtl("14:30"),
    ]);
    // Header {{1}} and body {{1}} are different variables, not a duplicate.
    expect(template.header![0]).not.toBe(template.parameters[0]);
  });

  it("gives both reminders the business, the time and the place", () => {
    const reminder = context({ kind: "reminder" });

    for (const leadHours of [24, 2]) {
      const template = whatsappTemplateFor(reminder, { leadHours })!;
      expect(template.header).toBeUndefined();
      expect(template.parameters).toEqual([
        "מספרת בלאק",
        anchorRtl("14:30"),
        anchorRtl("הרצל 10, תל אביב"),
      ]);
    }
  });

  /**
   * The confirmation carries no address and the reminders carry no client name,
   * which is why one shared parameter list could not survive the real copy.
   */
  it("does not give the three templates the same parameters", () => {
    const confirmation = whatsappTemplateFor(context())!;
    const reminder = whatsappTemplateFor(context({ kind: "reminder" }), {
      leadHours: 24,
    })!;

    expect(reminder.parameters).not.toEqual(confirmation.parameters);
  });
});

describe("the management button", () => {
  /**
   * Meta stores the button's base URL at approval time and appends only the
   * tail. The base registered here is `https://www.bazman.app/` — **without**
   * `b/` — so sending the whole `manageUrl` would render
   * `https://www.bazman.app/https://www.bazman.app/b/…` and reach nobody.
   */
  it("sends the bare token, never a URL", () => {
    const confirmation = whatsappTemplateFor(context())!;

    expect(confirmation.buttonUrlSuffix).toBe(TOKEN);
    expect(confirmation.buttonUrlSuffix).not.toContain("http");
    expect(confirmation.buttonUrlSuffix).not.toContain("/");
  });

  it("is on the 24h reminder and absent from the 2h one", () => {
    const reminder = context({ kind: "reminder" });

    expect(
      whatsappTemplateFor(reminder, { leadHours: 24 })!.buttonUrlSuffix,
    ).toBe(TOKEN);
    /**
     * `reminder_2h` was approved without a button. Sending a button parameter
     * for a template that has none is rejected outright by the Cloud API, so
     * this is a property of the approved artifact rather than a choice.
     */
    expect(
      whatsappTemplateFor(reminder, { leadHours: 2 })!.buttonUrlSuffix,
    ).toBeUndefined();
  });
});

describe("parameter values", () => {
  it("writes the date and the time as separate slots", () => {
    // The approved copy puts 📅 and ⏰ on their own lines, so they are two
    // variables. An earlier version fused them into one phrase.
    expect(datePhrase(context())).toContain("יום חמישי, 20/08/2026");
    expect(timePhrase(context())).toContain("14:30");
  });

  it("renders in the business timezone, not UTC", () => {
    expect(timePhrase(context())).not.toContain("11:30");
  });

  /**
   * The Cloud API rejects an empty body parameter outright, so a shop with no
   * address would have every templated message fail rather than arrive without
   * a location.
   */
  it("substitutes a placeholder rather than an empty string", () => {
    const confirmation = whatsappTemplateFor(
      context({ clientName: "  ", businessName: "" }),
    )!;
    expect(confirmation.header).toEqual(["—"]);
    expect(confirmation.parameters[0]).toBe("—");

    const reminder = whatsappTemplateFor(
      context({ kind: "reminder", businessAddress: null }),
      { leadHours: 24 },
    )!;
    expect(reminder.parameters).not.toContain("");
    // Anchored like every other emoji-adjacent parameter — see the direction
    // marks block below.
    expect(reminder.parameters[2]).toBe(anchorRtl("—"));
  });
});

/**
 * The iOS report: `⏰ 16:00` rendered with the clock on the *left*, mirrored
 * against every other line of a Hebrew message.
 */
describe("direction marks keep the emoji beside the number", () => {
  /** Strong right-to-left: Hebrew, or the mark itself. */
  const STRONG_RTL = /[‏֐-׿]/;

  /**
   * The defect and the fix in one assertion.
   *
   * "16:00" contains no strong directional character at all — digits are EN,
   * which is *weak* — so the Bidi algorithm falls back to left-to-right and a
   * client resolving direction per line flips the neutral emoji to the other
   * end. The mark is what gives that line something strong to resolve on.
   */
  it("gives the time the strong character it otherwise has none of", () => {
    expect(STRONG_RTL.test("16:00")).toBe(false);
    expect(STRONG_RTL.test(timePhrase(context()))).toBe(true);
  });

  it("anchors every parameter that shares a line with an emoji", () => {
    const confirmation = whatsappTemplateFor(context())!;
    const reminder = whatsappTemplateFor(context({ kind: "reminder" }), {
      leadHours: 24,
    })!;

    // 📅 date, ⏰ time on the confirmation; ⏰ time, 📍 place on the reminder.
    for (const value of [
      confirmation.parameters[1],
      confirmation.parameters[2],
      reminder.parameters[1],
      reminder.parameters[2],
    ]) {
      expect(value.startsWith(RLM)).toBe(true);
      expect(value.endsWith(RLM)).toBe(true);
    }
  });

  /**
   * The business name sits mid-sentence after Hebrew that already resolves the
   * line — "התור ל{{1}}". Marking it would be noise, and the point of anchoring
   * only the ambiguous parameters is that the rule stays legible.
   */
  it("leaves a parameter that is already inside Hebrew alone", () => {
    expect(whatsappTemplateFor(context())!.parameters[0]).toBe("מספרת בלאק");
  });

  it("changes not one visible character", () => {
    // Zero-width by definition: strip the marks and the client reads exactly
    // what it read before. In particular the digits stay in order.
    expect(strip(timePhrase(context()))).toBe("14:30");
    expect(strip(datePhrase(context()))).toBe("יום חמישי, 20/08/2026");
  });

  it("still anchors the placeholder when a shop has no address", () => {
    const reminder = whatsappTemplateFor(
      context({ kind: "reminder", businessAddress: null }),
      { leadHours: 2 },
    )!;
    expect(strip(reminder.parameters[2])).toBe("—");
    expect(STRONG_RTL.test(reminder.parameters[2])).toBe(true);
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
