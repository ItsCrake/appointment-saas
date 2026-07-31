"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import {
  cancelPendingNotificationsForAppointment,
  createAppointment,
  getService,
  SlotTakenError,
  updateAppointmentStatus,
} from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import {
  enqueueBookingNotifications,
  enqueueCancellationNotifications,
} from "@/lib/notifications/enqueue";
import { normalizePhone } from "@/lib/validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

const manualBookingSchema = z.object({
  serviceId: z.uuid("יש לבחור שירות"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
  clientName: z.string().trim().min(2, "יש להזין שם").max(80),
  clientPhone: z.string().trim().min(1, "יש להזין טלפון"),
  clientEmail: z.union([z.email("אימייל לא תקין"), z.literal("")]).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Walk-ins and phone bookings. Deliberately skips the availability engine: an
 * owner may book outside posted hours or inside a break. The DB exclusion
 * constraint still applies, so a genuine double-booking is impossible.
 */
export async function createManualBookingAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = manualBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireBusiness();
  const { serviceId, date, time, clientName, clientPhone, clientEmail, notes } =
    parsed.data;

  const service = await getService(db, business.id, serviceId);
  if (!service) return { ok: false, error: "השירות לא נמצא" };

  // The owner types local wall-clock time; the column stores UTC.
  const startsAt = fromZonedTime(`${date}T${time}:00`, business.timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  try {
    const appointment = await createAppointment(db, {
      businessId: business.id,
      serviceId,
      startsAt,
      endsAt,
      status: "confirmed",
      clientName,
      clientPhone: normalizePhone(clientPhone),
      clientEmail: clientEmail || null,
      notes: notes || null,
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });

    try {
      await enqueueBookingNotifications({ db, business, appointment });
    } catch (error) {
      console.error("enqueueBookingNotifications failed", error);
    }
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return { ok: false, error: "יש כבר תור שחופף למועד הזה" };
    }
    console.error("createManualBookingAction failed", error);
    return { ok: false, error: "אירעה שגיאה ביצירת התור" };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}

const statusSchema = z.enum(["confirmed", "cancelled", "completed", "no_show"]);

/**
 * The business id comes from the session, never from the caller — an owner can
 * only ever touch their own appointments.
 */
export async function setAppointmentStatusAction(
  appointmentId: string,
  status: string,
): Promise<ActionResult> {
  const parsedId = z.uuid().safeParse(appointmentId);
  const parsedStatus = statusSchema.safeParse(status);

  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, error: "בקשה לא תקינה" };
  }

  const { business } = await requireBusiness();

  const updated = await updateAppointmentStatus(
    db,
    business.id,
    parsedId.data,
    parsedStatus.data,
  );

  if (!updated) return { ok: false, error: "התור לא נמצא" };

  // Cancelling from the dashboard should notify the client, exactly as the
  // self-service link does.
  if (parsedStatus.data === "cancelled") {
    try {
      await cancelPendingNotificationsForAppointment(db, updated.id);
      await enqueueCancellationNotifications({
        db,
        business,
        appointment: updated,
      });
    } catch (error) {
      console.error("cancellation notifications failed", error);
    }
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
