"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import {
  BLOCKING_STATUSES,
  cancelPendingNotificationsForAppointment,
  createAppointment,
  deletePendingNotificationsForAppointment,
  getAppointment,
  getService,
  listAppointmentsInRange,
  rescheduleAppointment,
  SlotTakenError,
  updateAppointmentDetails,
  updateAppointmentStatus,
} from "@/db/queries";
import { getDefaultStaff, getStaff } from "@/db/queries/staff";
import {
  getAvailableSlotsWithStaff,
  staffAvailableAt,
} from "@/lib/availability";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import {
  enqueueApprovalNotifications,
  enqueueBookingNotifications,
  enqueueCancellationNotifications,
  enqueueRejectionNotifications,
  enqueueReminder,
} from "@/lib/notifications/enqueue";
import { normalizePhone } from "@/lib/validation";

export type ActionResult =
  { ok: true; warning?: string } | { ok: false; error: string };

const manualBookingSchema = z.object({
  serviceId: z.uuid("יש לבחור שירות"),
  /** Omitted by a single-staff tenant; the sole provider is resolved server-side. */
  staffId: z.uuid("נותן שירות לא תקין").optional(),
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
  const {
    serviceId,
    staffId: requestedStaffId,
    date,
    time,
    clientName,
    clientPhone,
    clientEmail,
    notes,
  } = parsed.data;

  const service = await getService(db, business.id, serviceId);
  if (!service) return { ok: false, error: "השירות לא נמצא" };

  /**
   * The owner may book anyone, including outside that person's posted hours —
   * this action skips the availability engine on purpose. What it cannot do is
   * book a provider who belongs to another tenant, so the id is resolved
   * through the business rather than trusted.
   */
  const assigned = requestedStaffId
    ? await getStaff(db, business.id, requestedStaffId)
    : await getDefaultStaff(db, business.id);

  if (!assigned) {
    return { ok: false, error: "נותן השירות לא נמצא" };
  }

  // The owner types local wall-clock time; the column stores UTC.
  const startsAt = fromZonedTime(`${date}T${time}:00`, business.timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  try {
    const appointment = await createAppointment(db, {
      businessId: business.id,
      serviceId,
      staffId: assigned.id,
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

const rescheduleSchema = z.object({
  appointmentId: z.uuid("בקשה לא תקינה"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
  /** Absent, or "", means "keep whoever has it". */
  staffId: z.union([z.uuid("נותן שירות לא תקין"), z.literal("")]).optional(),
});

/**
 * Moves an existing appointment.
 *
 * ---------------------------------------------------------------------------
 * **A reschedule is a booking, and is held to a booking's rules.** Nothing the
 * browser sends is trusted beyond the requested instant:
 *
 * 1. the appointment is re-read through the session's business, so another
 *    tenant's id does not resolve;
 * 2. a terminal appointment cannot be moved — a cancelled slot is not a
 *    booking, and moving it would resurrect it as one;
 * 3. `endsAt` is re-derived from the stored service duration, never sent;
 * 4. the requested instant must appear in **freshly computed availability**,
 *    with this appointment excluded from the busy set so it cannot block
 *    itself;
 * 5. the provider must genuinely be free then, re-derived from that same
 *    computation rather than taken from the request;
 * 6. `appointments_no_overlap_staff` settles any remaining race, because the
 *    write goes through `rescheduleAppointment` and not a bare update.
 *
 * **This deliberately applies availability where `createManualBookingAction`
 * skips it.** The two are different acts: a manual booking is the owner adding
 * something they know about — a walk-in, a favour, a job that runs past
 * closing — while a reschedule is moving a *client's* appointment, and a client
 * must not be quietly moved to a time the shop is shut. An owner who really
 * wants an off-hours slot still has the manual route, and the refusal below
 * says which of the two reasons stopped them so that choice is an informed one.
 * ---------------------------------------------------------------------------
 */
export async function rescheduleAppointmentAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const { appointmentId, date, time } = parsed.data;
  const requestedStaffId = parsed.data.staffId || undefined;

  const appointment = await getAppointment(db, business.id, appointmentId);
  if (!appointment) return { ok: false, error: "התור לא נמצא" };

  /**
   * Only an appointment that still holds its slot can be moved.
   *
   * Asked as "does it block?" rather than "is it terminal?" because that is the
   * same predicate the exclusion constraint uses — a cancelled or completed
   * booking has already released its time, and moving one would resurrect it as
   * a live appointment somewhere else.
   */
  if (!BLOCKING_STATUSES.includes(appointment.status)) {
    return {
      ok: false,
      error: "לא ניתן להעביר תור שבוטל, הושלם או סומן כלא הגיע",
    };
  }

  const service = await getService(db, business.id, appointment.serviceId);
  if (!service) return { ok: false, error: "השירות של התור לא נמצא" };

  /**
   * The provider is resolved through the business, exactly as manual booking
   * does it, so a staff id belonging to another tenant cannot be written onto
   * this appointment. With no request at all the appointment keeps its own.
   */
  const assigned = requestedStaffId
    ? await getStaff(db, business.id, requestedStaffId)
    : { id: appointment.staffId };

  if (!assigned) return { ok: false, error: "נותן השירות לא נמצא" };

  // The owner types local wall-clock time; the column stores UTC. Length comes
  // from the service, so the check below and the write describe one booking.
  const startsAt = fromZonedTime(`${date}T${time}:00`, business.timezone);
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

  const clash = await overlappingAppointment(
    business.id,
    assigned.id,
    appointment.id,
    startsAt,
    endsAt,
  );
  if (clash) {
    return { ok: false, error: "יש כבר תור אחר במועד הזה" };
  }

  /**
   * A deactivated service has no availability by definition —
   * `getAvailableSlotsWithStaff` returns nothing for a service nobody can book
   * — so running the engine against one would refuse every move of an
   * appointment whose service has since been retired. That is a normal state:
   * services are deactivated rather than deleted precisely because they hold
   * history. The clash check above plus the exclusion constraint below are what
   * guard those, which is the same standard a manual booking is held to.
   */
  if (service.isActive) {
    const slots = await getAvailableSlotsWithStaff(db, {
      businessId: business.id,
      serviceId: appointment.serviceId,
      date,
      excludeAppointmentId: appointment.id,
    });

    /**
     * Nothing bookable at all: the shop is closed that day, or fully taken.
     * Answered first because it is the one refusal with a specific cause the
     * owner can act on.
     */
    if (slots.length === 0) {
      return {
        ok: false,
        error: "אין מועדים פנויים בתאריך הזה — בדקו את שעות הפעילות",
      };
    }

    /**
     * **Whether the engine models this provider at all**, which is not the same
     * question as whether they are free.
     *
     * `getAvailableSlotsWithStaff` only ever considers *bookable* providers, and
     * two ordinary states put an appointment's provider outside that set: a
     * shop that collapsed back to one chair, where only the primary is handed
     * to the engine, and a provider who has since been deactivated. Neither
     * deletes the person, precisely because they hold history — so both leave
     * real appointments whose provider the engine has nothing to say about.
     *
     * Reading that silence as "not free" would make those appointments
     * permanently unmovable. Reading it as inconclusive falls back to the clash
     * check above and the exclusion constraint below, which is the same standard
     * a manual booking is held to. A provider the engine *does* model appears in
     * some slot on any open day — with no schedule rows of their own they
     * inherit the shop's hours — so every ordinary move is still governed by the
     * strict check.
     */
    const modelled = slots.some((slot) => slot.staffIds.includes(assigned.id));

    if (modelled && !staffAvailableAt(slots, startsAt.toISOString()).includes(assigned.id)) {
      return {
        ok: false,
        error:
          "המועד הזה אינו פנוי בלוח הזמנים. אפשר לקבוע תור ידני מחוץ לשעות הפעילות.",
      };
    }
  }

  let updated;
  try {
    updated = await rescheduleAppointment(db, business.id, appointment.id, {
      startsAt,
      endsAt,
      staffId: requestedStaffId,
    });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return { ok: false, error: "יש כבר תור שחופף למועד הזה" };
    }
    reportError("dashboard.reschedule", error, {
      businessId: business.id,
      appointmentId: appointment.id,
    });
    return { ok: false, error: "אירעה שגיאה בהעברת התור" };
  }

  if (!updated) return { ok: false, error: "התור לא נמצא" };

  /**
   * The reminder was scheduled for a time that no longer exists.
   *
   * Dropping the pending rows and re-planning is the whole job: the dispatcher
   * already derives `reminder_24h` vs `reminder_2h` from the appointment's live
   * `startsAt`, so the *wording* of a moved reminder was always going to be
   * right — what was wrong was **when it fires**. An appointment pushed from
   * Friday to next Tuesday would otherwise have reminded the client on
   * Thursday. See `deletePendingNotificationsForAppointment` for why these are
   * deleted rather than skipped.
   *
   * The client is **not** told the appointment moved. That needs a template
   * kind this system does not have — see PROJECT_PLAN §5 on the five
   * unsubmitted Meta templates — and inventing one here would queue messages
   * the official path refuses to send.
   */
  try {
    await deletePendingNotificationsForAppointment(db, updated.id);
    await enqueueReminder({ db, business, appointment: updated });
  } catch (error) {
    // Never turn a completed move into an error: the appointment has already
    // moved, and an owner told it failed would move it again.
    reportError("dashboard.reschedule.notify", error, {
      appointmentId: updated.id,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda/full");
  revalidatePath(`/${business.slug}`);

  return { ok: true };
}

/**
 * Whether anything else already holds [startsAt, endsAt) for this provider.
 *
 * Only here to tell the owner *why* a move was refused — "somebody is already
 * booked" and "that is outside your hours" are the two reasons, they need
 * different answers, and availability alone cannot tell them apart. It is not a
 * safety check: the exclusion constraint is, and it runs whatever this returns.
 */
async function overlappingAppointment(
  businessId: string,
  staffId: string,
  excludeId: string,
  startsAt: Date,
  endsAt: Date,
) {
  // Defaults to the blocking statuses, which is exactly the constraint's
  // predicate — a cancelled or completed appointment frees its time.
  const rows = await listAppointmentsInRange(db, businessId, startsAt, endsAt);

  return rows.find((row) => row.staffId === staffId && row.id !== excludeId);
}

const detailsSchema = z.object({
  appointmentId: z.uuid("בקשה לא תקינה"),
  clientName: z.string().trim().min(2, "יש להזין שם").max(80),
  clientPhone: z.string().trim().min(1, "יש להזין טלפון"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Corrects a booking's details — the name, the number, the note.
 *
 * Not the service or the price: those are snapshots taken at booking time so
 * that history survives later edits to the catalogue, and rewriting them here
 * would rewrite what was sold. Not the times either — that is a reschedule, and
 * it has to clear availability and the overlap guard.
 *
 * The phone is normalised on the way in, exactly as both booking paths do it,
 * because it is the key a client profile and every future message hang off.
 */
export async function updateAppointmentDetailsAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const { appointmentId, clientName, clientPhone, notes } = parsed.data;

  const updated = await updateAppointmentDetails(
    db,
    business.id,
    appointmentId,
    {
      clientName,
      clientPhone: normalizePhone(clientPhone),
      notes: notes || null,
    },
  );

  if (!updated) return { ok: false, error: "התור לא נמצא" };

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/agenda/full");
  revalidatePath("/dashboard/clients");

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

  const { business } = await requireWritable();

  /**
   * Read first, because **what the client should be told depends on where the
   * appointment came from**, and the update destroys that. Approving a request
   * and un-cancelling a booking both land on `confirmed`; rejecting a request
   * and cancelling a booking both land on `cancelled`. By the time the row has
   * been written the two are indistinguishable.
   *
   * A read-then-write race needs two owners acting on one appointment in the
   * same second; the cost of losing it is one message with the wrong wording.
   */
  const before = await getAppointment(db, business.id, parsedId.data);
  if (!before) return { ok: false, error: "התור לא נמצא" };

  const wasRequest = before.status === "pending";

  const updated = await updateAppointmentStatus(
    db,
    business.id,
    parsedId.data,
    parsedStatus.data,
  );

  if (!updated) return { ok: false, error: "התור לא נמצא" };

  try {
    if (parsedStatus.data === "cancelled") {
      await cancelPendingNotificationsForAppointment(db, updated.id);

      // "התור שלך בוטל" is wrong for something that was never confirmed.
      await (wasRequest
        ? enqueueRejectionNotifications({ db, business, appointment: updated })
        : // Cancelling from the dashboard notifies the client exactly as the
          // self-service link does.
          enqueueCancellationNotifications({
            db,
            business,
            appointment: updated,
          }));
    } else if (parsedStatus.data === "confirmed" && wasRequest) {
      // Approval is also when the reminder finally gets scheduled — it was
      // deliberately withheld while the answer was still unknown.
      await enqueueApprovalNotifications({
        db,
        business,
        appointment: updated,
      });
    }
  } catch (error) {
    // Never turn a successful status change into an error: the appointment has
    // already moved, and the owner would click again.
    reportError("dashboard.status.notify", error, {
      appointmentId: updated.id,
      status: parsedStatus.data,
    });
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
