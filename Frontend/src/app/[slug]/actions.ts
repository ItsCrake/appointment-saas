"use server";

import { randomUUID } from "node:crypto";

import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import { bookingStatusFor } from "@/lib/approval";
import {
  createAppointment,
  getActiveBusinessBySlug,
  getService,
  SlotTakenError,
  upsertWaitlistEntry,
} from "@/db/queries";
import {
  getAvailableSlotsWithStaff,
  staffAvailableAt,
  type SlotWithStaff,
} from "@/lib/availability";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import { enqueueBookingNotifications } from "@/lib/notifications/enqueue";
import { reportError, reportWarning } from "@/lib/observability";
import { sendPushToBusiness } from "@/lib/push";
import {
  BOOKING_RULES,
  rateLimitMessage,
  SLOTS_RULE,
  WAITLIST_RULES,
} from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { getClientIp } from "@/lib/request-context";
import {
  bookingInputSchema,
  looksAutomated,
  normalizePhone,
} from "@/lib/validation";

export type SlotsResult =
  { ok: true; slots: SlotWithStaff[] } | { ok: false; error: string };

/**
 * Availability for one day. Called from the client on every date change, so it
 * resolves the business by slug rather than trusting an id from the browser.
 */
export async function fetchSlotsAction(
  slug: string,
  serviceId: string,
  date: string,
): Promise<SlotsResult> {
  // Cheap per call, but an unauthenticated endpoint worth capping anyway.
  const limited = await enforceRateLimits(db, [
    { rule: SLOTS_RULE, identifier: await getClientIp() },
  ]);
  if (!limited.allowed) {
    return { ok: false, error: rateLimitMessage(limited.decision) };
  }

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) return { ok: false, error: "העסק לא נמצא" };

  try {
    // Returns who is free at each time as well as the time itself, so the
    // staff picker reads from the same computation that offered the slot and
    // cannot disagree with it.
    const slots = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId,
      date,
    });
    return { ok: true, slots };
  } catch (error) {
    reportError("booking.slots", error, { slug, serviceId, date });
    return { ok: false, error: "שגיאה בטעינת המועדים. נסו שוב." };
  }
}

export type BookingConfirmation = {
  id: string;
  cancelToken: string;
  serviceName: string;
  priceCents: number;
  currency: string;
  startsAt: string;
  endsAt: string;
  businessName: string;
  businessTimezone: string;
  clientName: string;
  clientPhone: string;
  /**
   * `true` when the tenant runs "תורים באישור" and this is a *request*, not a
   * booking. The confirmation screen reads completely differently in that case
   * — a client who thinks they have an appointment will turn up for it.
   */
  awaitingApproval: boolean;
};

export type BookingResult =
  | { ok: true; appointment: BookingConfirmation }
  | {
      ok: false;
      error: string;
      code?: "SLOT_TAKEN" | "VALIDATION" | "RATE_LIMITED";
    };

/**
 * A confirmation shaped exactly like a real one, backed by nothing. Only ever
 * returned to a submission that tripped the honeypot.
 */
function fabricateConfirmation(input: {
  clientName: string;
  clientPhone: string;
  startsAt: string;
}): BookingConfirmation {
  return {
    id: randomUUID(),
    cancelToken: randomUUID(),
    serviceName: "",
    priceCents: 0,
    currency: "ILS",
    startsAt: input.startsAt,
    endsAt: input.startsAt,
    businessName: "",
    businessTimezone: "Asia/Jerusalem",
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    awaitingApproval: false,
  };
}

/**
 * Creates the appointment. Everything the client sent is re-derived or
 * re-checked here:
 *
 * 1. the payload is parsed with Zod;
 * 2. the service must belong to this business and be active;
 * 3. `endsAt` comes from the stored service duration, never from the client;
 * 4. the requested instant must still appear in freshly computed availability;
 * 5. the DB exclusion constraint settles any remaining race.
 */
export async function createBookingAction(
  input: unknown,
): Promise<BookingResult> {
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      error: parsed.error.issues[0]?.message ?? "הפרטים שהוזנו אינם תקינים",
    };
  }

  const {
    slug,
    serviceId,
    startsAt,
    staffId: requestedStaffId,
    clientName,
    clientPhone,
    clientEmail,
    notes,
    consentMarketing,
  } = parsed.data;

  // Resolved from the slug, never taken from the payload: the browser must not
  // be able to nominate which tenant a booking is written against.
  const businessRow = await getActiveBusinessBySlug(db, slug);
  if (!businessRow) {
    return { ok: false, error: "העסק אינו זמין לקביעת תורים" };
  }
  const businessId = businessRow.id;

  const clientIp = await getClientIp();
  const normalisedPhone = normalizePhone(clientPhone);

  // Rate limits are consumed *before* the honeypot check on purpose. If the
  // honeypot short-circuited first, a script that fills it would get an
  // unlimited supply of free requests; this way its traffic still burns the
  // IP budget and gets throttled like anything else.
  const limited = await enforceRateLimits(db, [
    { rule: BOOKING_RULES.ipHourly, identifier: clientIp },
    { rule: BOOKING_RULES.ipDaily, identifier: clientIp },
    {
      rule: BOOKING_RULES.phoneDaily,
      identifier: `${businessId}:${normalisedPhone}`,
    },
  ]);

  if (!limited.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      error: rateLimitMessage(limited.decision),
    };
  }

  // Honeypot / timing check. Returns a fabricated success so a script gets no
  // signal to tune against — nothing is written. Logged so we can audit every
  // trip and spot a false positive if one ever occurs.
  const automated = looksAutomated(parsed.data);
  if (automated.automated) {
    reportWarning("antispam.honeypot", automated.reason ?? "automated", {
      businessId,
    });
    return { ok: true, appointment: fabricateConfirmation(parsed.data) };
  }

  // Scoped by the resolved businessId, so a service id from another tenant
  // simply does not resolve.
  const service = await getService(db, businessId, serviceId);
  if (!service || !service.isActive) {
    return { ok: false, error: "השירות שנבחר אינו זמין" };
  }

  const start = new Date(startsAt);
  const end = new Date(start.getTime() + service.durationMin * 60_000);

  // Re-validate against live availability, using the business-local calendar
  // date of the requested instant.
  const localDate = formatInTimeZone(start, businessRow.timezone, "yyyy-MM-dd");
  const slots = await getAvailableSlotsWithStaff(db, {
    businessId,
    serviceId,
    date: localDate,
  });

  // Who is genuinely free at the requested instant, re-derived here rather than
  // trusted from the request. The client's pick is a preference.
  const freeStaff = staffAvailableAt(slots, start.toISOString());
  if (freeStaff.length === 0) {
    return {
      ok: false,
      code: "SLOT_TAKEN",
      error: "המועד שנבחר כבר אינו פנוי. בחרו מועד אחר.",
    };
  }

  /**
   * A requested provider is honoured only if they are in that list. Falling
   * back to the first free one when the request names someone who is not would
   * silently book a client with the wrong person; refusing is the honest
   * answer, and the client is sent back to pick again.
   *
   * With no request at all — a single-staff tenant, or "anyone" — the first
   * free provider takes it, in the display order `listActiveStaff` fixes.
   */
  if (requestedStaffId && !freeStaff.includes(requestedStaffId)) {
    return {
      ok: false,
      code: "SLOT_TAKEN",
      error: "נותן השירות שנבחר כבר אינו פנוי במועד הזה. בחרו שוב.",
    };
  }

  const staffId = requestedStaffId ?? freeStaff[0];

  try {
    const appointment = await createAppointment(db, {
      businessId,
      serviceId,
      staffId,
      startsAt: start,
      endsAt: end,
      /**
       * The shop's flag OR this service's own (0029) — see `bookingStatusFor`.
       * A shop that vets everything keeps vetting everything; a service marked
       * for approval inside an otherwise auto-confirming shop becomes the one
       * exception.
       *
       * `pending` holds the slot exactly as `confirmed` does — it is
       * non-terminal, so the exclusion constraint blocks it. A request that
       * did not reserve the time would be a request to be disappointed:
       * someone else books it while the owner is deciding.
       */
      status: bookingStatusFor({ business: businessRow, service }),
      clientName,
      clientPhone: normalisedPhone,
      clientEmail: clientEmail || null,
      notes: notes || null,
      /**
       * Consent is stored **only when the tenant is actually running the
       * campaign**. A shop with retention switched off never renders the box,
       * so a `true` arriving from such a page came from a crafted request, and
       * recording it would manufacture consent that no client was ever shown
       * the wording for.
       */
      clientConsentedMarketing:
        businessRow.retentionEnabled && consentMarketing === true,
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });

    // Best-effort: the booking is already committed, so a notification
    // problem must never turn a successful booking into an error.
    try {
      const queued = await enqueueBookingNotifications({
        db,
        business: businessRow,
        appointment,
      });

      /**
       * Send this booking's messages now rather than on the next sweep.
       *
       * The outbox still owns durability — the row stays pending and the cron
       * retries it — but "next sweep" is up to 15 minutes on the external
       * scheduler and a full day on Vercel's Hobby cron. A client who has just
       * tapped "book" should not wait either of those for the WhatsApp that
       * proves it worked. The sweep keeps the jobs only it can do: the 24h and
       * 2h reminders, retries, billing warnings and win-back.
       *
       * **Awaited**, exactly as the dashboard's manual booking does it. An
       * earlier version deferred this into `after()` so the confirmation screen
       * could never wait on a provider — better on paper, but it makes delivery
       * depend on the platform actually running deferred work after the
       * response, and a message that quietly falls back to the cron is the
       * failure mode this whole change exists to remove. Determinism wins: the
       * send either happened or it is reported.
       *
       * What makes awaiting safe is the timeout inside the provider's own
       * fetch. Without it a hung Meta connection would hold the booking
       * response open until the platform killed the function.
       */
      if (queued.length > 0) {
        try {
          await dispatchDueNotifications(db, {
            appointmentId: appointment.id,
            limit: 10,
          });
        } catch (error) {
          reportError("booking.dispatch", error, {
            businessId,
            appointmentId: appointment.id,
          });
        }
      }
    } catch (error) {
      reportError("booking.notify", error, {
        businessId,
        appointmentId: appointment.id,
      });
    }

    /**
     * The owner's phone, separately from the outbox and for a reason: a push
     * is a nudge whose value expires in a minute. The booking is on their
     * dashboard and the email alert is queued either way, so this one sends
     * inline, best-effort, and never delays or fails the booking.
     */
    if (businessRow.pushEnabled) {
      try {
        const when = formatInTimeZone(start, businessRow.timezone, "d.M HH:mm");
        await sendPushToBusiness(db, businessId, {
          title: appointment.status === "pending" ? "בקשת תור חדשה" : "תור חדש",
          body: `${clientName} · ${service.name} · ${when}`,
          url: "/dashboard",
        });
      } catch (error) {
        reportError("booking.push", error, {
          businessId,
          appointmentId: appointment.id,
        });
      }
    }

    return {
      ok: true,
      appointment: {
        id: appointment.id,
        cancelToken: appointment.cancelToken,
        serviceName: appointment.serviceName,
        priceCents: appointment.priceCents,
        currency: service.currency,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        businessName: businessRow.name,
        businessTimezone: businessRow.timezone,
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        // Read from the written row, not from the business flag: whatever the
        // database actually stored is what the client is told.
        awaitingApproval: appointment.status === "pending",
      },
    };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return {
        ok: false,
        code: "SLOT_TAKEN",
        error: "המועד נתפס בדיוק עכשיו. בחרו מועד אחר.",
      };
    }
    reportError("booking.create", error, { businessId, serviceId });
    return { ok: false, error: "אירעה שגיאה בקביעת התור. נסו שוב." };
  }
}

/* -------------------------------------------------------------------------- */
/* Waitlist                                                                    */
/* -------------------------------------------------------------------------- */

const waitlistSchema = z.object({
  slug: z.string().trim().min(1),
  clientName: z.string().trim().min(2, "יש להזין שם").max(80),
  clientPhone: z.string().trim().min(1, "יש להזין טלפון"),
  /** "" is the "any service" answer the form offers by default. */
  serviceId: z.union([z.uuid(), z.literal("")]).optional(),
  /** 0 = Sunday, matching the rest of the schema. Empty means any day. */
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferredTimeWindow: z
    .enum(["morning", "afternoon", "evening", "any"])
    .default("any"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type WaitlistResult =
  { ok: true; rejoined: boolean } | { ok: false; error: string };

/**
 * Joins the queue for a shop whose calendar has nothing to offer.
 *
 * ---------------------------------------------------------------------------
 * Unauthenticated by necessity — the whole point is that this person has no
 * booking and no account — so it is held to the same rules as the booking flow
 * beside it: the tenant is resolved from the **slug**, never from the payload,
 * the phone is normalised the way every other client record stores it, and the
 * write is rate limited per IP and per number.
 *
 * `is_active` is what a frozen tenant is filtered on, exactly as in
 * `createBookingAction`: a shop that is not taking bookings is not taking
 * waitlist entries either, and offering the form would be collecting details
 * nobody will act on.
 *
 * A service id is checked against *this* business rather than trusted, so a uuid
 * lifted from another shop's page cannot attach a preference to a service this
 * one does not sell.
 * ---------------------------------------------------------------------------
 */
export async function joinWaitlistAction(
  input: unknown,
): Promise<WaitlistResult> {
  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "פרטים לא תקינים",
    };
  }

  const { slug, clientName, clientPhone, preferredDays, preferredTimeWindow } =
    parsed.data;

  const business = await getActiveBusinessBySlug(db, slug);
  if (!business) {
    return { ok: false, error: "העסק אינו זמין כרגע" };
  }

  const normalisedPhone = normalizePhone(clientPhone);

  const limited = await enforceRateLimits(db, [
    { rule: WAITLIST_RULES.ip, identifier: await getClientIp() },
    {
      rule: WAITLIST_RULES.phone,
      identifier: `${business.id}:${normalisedPhone}`,
    },
  ]);

  if (!limited.allowed) {
    return { ok: false, error: rateLimitMessage(limited.decision) };
  }

  // Scoped by the resolved business, so another tenant's service id does not
  // resolve and simply becomes "any service".
  const requestedServiceId = parsed.data.serviceId || null;
  if (requestedServiceId) {
    const service = await getService(db, business.id, requestedServiceId);
    if (!service || !service.isActive) {
      return { ok: false, error: "השירות שנבחר אינו זמין" };
    }
  }

  try {
    const { rejoined } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName,
      clientPhone: normalisedPhone,
      serviceId: requestedServiceId,
      // Not offered on the public form: a client choosing a provider is a
      // booking-flow decision, and the queue is about getting *in*. The column
      // exists for the owner adding somebody by hand.
      preferredStaffId: null,
      preferredDays,
      preferredTimeWindow,
      notes: parsed.data.notes || null,
    });

    return { ok: true, rejoined };
  } catch (error) {
    reportError("waitlist.join", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בהצטרפות לרשימה. נסו שוב." };
  }
}
