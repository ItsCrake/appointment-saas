"use server";

import { randomUUID } from "node:crypto";

import { formatInTimeZone } from "date-fns-tz";

import { db } from "@/db";
import {
  createAppointment,
  getActiveBusinessBySlug,
  getService,
  SlotTakenError,
} from "@/db/queries";
import { getAvailableSlots, type Slot } from "@/lib/availability";
import { enqueueBookingNotifications } from "@/lib/notifications/enqueue";
import { BOOKING_RULES, rateLimitMessage, SLOTS_RULE } from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { getClientIp } from "@/lib/request-context";
import {
  bookingInputSchema,
  looksAutomated,
  normalizePhone,
} from "@/lib/validation";

export type SlotsResult =
  { ok: true; slots: Slot[] } | { ok: false; error: string };

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
    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId,
      date,
    });
    return { ok: true, slots };
  } catch (error) {
    console.error("fetchSlotsAction failed", error);
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
    clientName,
    clientPhone,
    clientEmail,
    notes,
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
    console.warn(
      `[antispam] discarded booking for business ${businessId}: ${automated.reason}`,
    );
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
  const slots = await getAvailableSlots(db, {
    businessId,
    serviceId,
    date: localDate,
  });

  const stillFree = slots.some((s) => s.startsAt === start.toISOString());
  if (!stillFree) {
    return {
      ok: false,
      code: "SLOT_TAKEN",
      error: "המועד שנבחר כבר אינו פנוי. בחרו מועד אחר.",
    };
  }

  try {
    const appointment = await createAppointment(db, {
      businessId,
      serviceId,
      startsAt: start,
      endsAt: end,
      status: "confirmed",
      clientName,
      clientPhone: normalisedPhone,
      clientEmail: clientEmail || null,
      notes: notes || null,
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });

    // Best-effort: the booking is already committed, so a notification
    // problem must never turn a successful booking into an error.
    try {
      await enqueueBookingNotifications({
        db,
        business: businessRow,
        appointment,
      });
    } catch (error) {
      console.error("enqueueBookingNotifications failed", error);
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
    console.error("createBookingAction failed", error);
    return { ok: false, error: "אירעה שגיאה בקביעת התור. נסו שוב." };
  }
}
