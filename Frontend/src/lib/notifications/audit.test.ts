import { describe, expect, it } from "vitest";

import { notificationKind } from "@/db/schema";
import { toE164 } from "@/lib/notifications/providers";
import { renderNotification } from "@/lib/notifications/templates";
import {
  isBillingKind,
  isWaitlistKind,
  type NotificationContext,
  type NotificationKind,
} from "@/lib/notifications/types";
import { whatsappTemplateFor } from "@/lib/notifications/whatsapp-templates";
import { normalizePhone } from "@/lib/validation";

/**
 * Every message the product can send, rendered.
 *
 * ---------------------------------------------------------------------------
 * **Driven off the enum, so a new kind cannot be added without landing here.**
 * The failure this exists to catch is silent: a kind with no template branch
 * falls through, and what a client receives is a subject and an empty body — or
 * worse, a body with `undefined` in the middle of it. Neither throws, neither
 * fails a build, and both are only visible to the person who got the message.
 *
 * It also records, mechanically, **which kinds the official WhatsApp path can
 * actually deliver**. That list is shorter than the enum and the difference is
 * not a bug — it is the Meta template backlog — but it should be a fact the
 * suite states rather than something rediscovered by reading dispatch code.
 * ---------------------------------------------------------------------------
 */

const ALL_KINDS = notificationKind.enumValues as readonly NotificationKind[];

const APPOINTMENT_BASE = {
  businessName: "מספרת בלאק",
  businessPhone: "050-1234567",
  businessAddress: "דיזנגוף 100, תל אביב",
  businessTimezone: "Asia/Jerusalem",
  bookingUrl: "https://bazman.app/demo-barber",
  manageUrl: "https://bazman.app/b/tok-123",
  manageToken: "tok-123",
  clientName: "עומר לוי",
  serviceName: "תספורת גבר",
  priceCents: 7000,
  startsAt: "2026-08-04T07:00:00.000Z",
  status: "confirmed",
};

/** A filled context for any kind, so every branch can be rendered. */
function contextFor(kind: NotificationKind): NotificationContext {
  if (isBillingKind(kind)) {
    return {
      kind,
      businessName: "מספרת בלאק",
      businessTimezone: "Asia/Jerusalem",
      billingUrl: "https://bazman.app/dashboard/billing",
      planName: "מקצועי",
      deadline: "2026-09-01T00:00:00.000Z",
      daysLeft: 3,
      amountCents: 9900,
    };
  }

  if (isWaitlistKind(kind)) {
    return {
      kind,
      businessName: "מספרת בלאק",
      businessPhone: "050-1234567",
      businessAddress: "דיזנגוף 100, תל אביב",
      businessTimezone: "Asia/Jerusalem",
      inviteUrl: "https://bazman.app/w/inv-123",
      inviteToken: "inv-123",
      clientName: "עומר לוי",
      serviceName: "תספורת גבר",
      startsAt: "2026-08-04T07:00:00.000Z",
      offerExpiresAt: "2026-08-03T09:00:00.000Z",
    };
  }

  return { ...APPOINTMENT_BASE, kind } as NotificationContext;
}

describe("every notification kind renders something a person can read", () => {
  it("covers the whole enum, so a new kind cannot slip past", () => {
    expect(ALL_KINDS.length).toBeGreaterThanOrEqual(14);
  });

  it.each([...ALL_KINDS])("%s", (kind) => {
    const { subject, body } = renderNotification(contextFor(kind));

    expect(subject.trim().length).toBeGreaterThan(0);
    expect(body.trim().length).toBeGreaterThan(0);

    /**
     * The failure mode that does not throw: a template reading a field its
     * context does not carry renders the word `undefined` into the middle of a
     * sentence and sends it. Nothing else in the stack notices.
     */
    for (const leak of ["undefined", "NaN", "[object Object]"]) {
      expect(body).not.toContain(leak);
      expect(subject).not.toContain(leak);
    }
  });

  it("names the business in every client-facing message", () => {
    // A message with no shop name in it reads as spam, which for a WhatsApp
    // from an unknown number is the difference between kept and blocked.
    for (const kind of ALL_KINDS) {
      if (isBillingKind(kind)) continue;
      const { body } = renderNotification(contextFor(kind));
      expect(body).toContain("מספרת בלאק");
    }
  });
});

describe("phone numbers survive the trip to a provider", () => {
  /**
   * Two normalisers sit on this path and they are not the same one.
   * `normalizePhone` writes the stored form — Israeli local, `05…` — and
   * `toE164` turns that into what Meta and Twilio want. A booking typed in any
   * of these has to arrive at the same `+9725…`.
   */
  it.each([
    "050-123-4567",
    "0501234567",
    "+972501234567",
    "00972501234567",
    "972-50-1234567",
    " 050 123 4567 ",
  ])("%s reaches the provider as +972501234567", (typed) => {
    expect(toE164(normalizePhone(typed))).toBe("+972501234567");
  });

  it("does not mangle a number that is already E.164", () => {
    expect(toE164("+972501234567")).toBe("+972501234567");
  });

  it("keeps the leading zero out of the international form", () => {
    // The classic double-prefix bug: +9720501234567 is not a phone number, and
    // Meta rejects the send rather than delivering it somewhere odd.
    expect(toE164(normalizePhone("0501234567"))).not.toContain("+9720");
  });
});

describe("what the official WhatsApp path can actually send", () => {
  /**
   * A fact, recorded. Three approved Meta templates exist; every other kind
   * resolves to `null` and the official provider refuses rather than posting
   * text Meta drops silently. See PROJECT_PLAN §5 on the drafted-and-unsubmitted
   * backlog — this list is the shape of that gap, not a bug to fix here.
   */
  /**
   * `reminder` resolves only with a lead time, because that is what picks
   * between the two approved reminder templates — the dispatcher derives it
   * from the appointment's live `startsAt` against the row's `scheduled_for`,
   * so passing it here is reproducing the real call rather than helping the
   * test along.
   */
  const resolve = (kind: NotificationKind) =>
    whatsappTemplateFor(contextFor(kind), { leadHours: 24 });

  const deliverable = ALL_KINDS.filter((kind) => resolve(kind) !== null);

  it("is exactly the kinds with an approved template", () => {
    /**
     * Three templates are approved on the platform's Meta account —
     * `appointment_confirmation`, `reminder_24h` and `reminder_2h` — and the
     * last two are one *kind*. Everything else, including every waitlist invite
     * and every cancellation, resolves to null and is refused rather than sent
     * as text Meta drops silently.
     */
    expect([...deliverable].sort()).toEqual([
      "booking_confirmation",
      "reminder",
    ]);
  });

  it("refuses billing and waitlist kinds before the appointment cast", () => {
    /**
     * `whatsappTemplateFor` casts its context to an appointment once billing and
     * waitlist are excluded. A waitlist context carries no `manageToken` and no
     * price, so a branch reaching it would post `undefined` into an approved
     * template's parameters — which Meta accepts and renders to the client.
     */
    for (const kind of ALL_KINDS) {
      if (!isBillingKind(kind) && !isWaitlistKind(kind)) continue;
      expect(resolve(kind)).toBeNull();
    }
  });

  it("fills every parameter of the templates it does resolve", () => {
    // An approved template with an empty parameter is rejected by Meta at send
    // time, which surfaces as a failed row rather than a missing message.
    for (const kind of deliverable) {
      const template = resolve(kind);
      const filled = [
        ...(template?.header ?? []),
        ...(template?.parameters ?? []),
      ];

      expect(filled.length).toBeGreaterThan(0);
      for (const parameter of filled) {
        // Trimmed of the U+200F marks `anchorRtl` wraps around dates and times,
        // which are real content to Meta but whitespace to a reader.
        expect(String(parameter).replace(/‏/g, "").trim()).not.toBe("");
      }
    }
  });
});
