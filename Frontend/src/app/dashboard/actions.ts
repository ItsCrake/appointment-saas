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
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import {
  enqueueBookingNotifications,
  enqueueCancellationNotifications,
} from "@/lib/notifications/enqueue";
import { normalizePhone } from "@/lib/validation";

export type ActionResult =
  { ok: true; warning?: string } | { ok: false; error: string };

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

  const { business } = await requireWritable();
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

    // A walk-in booked over the phone usually has a number and no email, and
    // email is the only channel with a live provider today. That combination
    // silently queued nothing at all, which is what alpha testers saw as "the
    // client never got a confirmation". It is now reported rather than hidden.
    let queued: string[] = [];
    try {
      queued = await enqueueBookingNotifications({ db, business, appointment });

      // Send now instead of on the next cron tick. The outbox still owns
      // durability — the row stays pending and the daily run retries it — but
      // an owner standing in front of the client should not have to explain
      // that the confirmation arrives tomorrow morning.
      if (queued.length > 0) {
        await dispatchDueNotifications(db, {
          appointmentId: appointment.id,
          limit: 10,
        });
      }
    } catch (error) {
      // Never fails the booking. The appointment exists, and the outbox row
      // survives for the cron to pick up.
      reportError("dashboard.manualBooking.notify", error, {
        businessId: business.id,
      });
    }

    revalidatePath("/dashboard");
    revalidatePath(`/${business.slug}`);

    return queued.includes("booking_confirmation")
      ? { ok: true }
      : {
          ok: true,
          warning: "התור נקבע, אך לא נשלח אישור ללקוח: לא הוזנה כתובת אימייל.",
        };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return { ok: false, error: "יש כבר תור שחופף למועד הזה" };
    }
    reportError("dashboard.manualBooking", error, {
      businessId: business.id,
      serviceId,
    });
    return { ok: false, error: "אירעה שגיאה ביצירת התור" };
  }
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

  const { business } = await requireWritable();

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
      reportError("dashboard.cancel.notify", error, {
        appointmentId: updated.id,
      });
    }
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
