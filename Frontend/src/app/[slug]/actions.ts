"use server";

import { randomUUID } from "node:crypto";

import { formatInTimeZone } from "date-fns-tz";

import { db } from "@/db";
import {
  createAppointment,
  getActiveBusinessBySlug,
  getBusinessById,
  getService,
  SlotTakenError,
} from "@/db/queries";
import { getAvailableSlots, type Slot } from "@/lib/availability";
import { bookingInputSchema, normalizePhone } from "@/lib/validation";

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
  | { ok: false; error: string; code?: "SLOT_TAKEN" | "VALIDATION" };

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

  const { businessId, serviceId, startsAt, clientName, clientPhone, notes } =
    parsed.data;

  const [businessRow, service] = await Promise.all([
    getBusinessById(db, businessId),
    getService(db, businessId, serviceId),
  ]);

  if (!businessRow || !businessRow.isActive) {
    return { ok: false, error: "העסק אינו זמין לקביעת תורים" };
  }
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
      clientPhone: normalizePhone(clientPhone),
      notes: notes || null,
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });

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
