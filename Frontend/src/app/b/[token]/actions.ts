"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  cancelAppointmentByToken,
  cancelPendingNotificationsForAppointment,
  getAppointmentContextByToken,
} from "@/db/queries";
import { enqueueCancellationNotifications } from "@/lib/notifications/enqueue";
import { offerFreedSlotToWaitlist } from "@/lib/waitlist-offer";
import { getCancellationState } from "@/lib/cancellation";
import { reportError } from "@/lib/observability";

export type CancelResult = { ok: true } | { ok: false; error: string };

/**
 * Cancels via the token alone — that opaque uuid is the client's only
 * credential, so the window check has to happen here rather than in the UI.
 */
export async function cancelBookingAction(
  token: string,
): Promise<CancelResult> {
  const row = await getAppointmentContextByToken(db, token);
  if (!row) return { ok: false, error: "התור לא נמצא" };

  const { appointment, business } = row;

  if (appointment.status === "cancelled") {
    return { ok: false, error: "התור כבר בוטל" };
  }
  if (appointment.status === "completed" || appointment.status === "no_show") {
    return { ok: false, error: "לא ניתן לבטל תור שכבר התקיים" };
  }

  const state = getCancellationState(appointment, business.cancelWindowHours);

  if (!state.canCancel) {
    return {
      ok: false,
      error: `לא ניתן לבטל פחות מ-${business.cancelWindowHours} שעות לפני התור. צרו קשר עם העסק.`,
    };
  }

  const cancelled = await cancelAppointmentByToken(db, token);
  if (!cancelled) return { ok: false, error: "לא ניתן לבטל את התור" };

  try {
    // Drop the queued reminder first — nobody wants a reminder for a slot
    // they just cancelled.
    await cancelPendingNotificationsForAppointment(db, cancelled.id);
    // The client gave the slot up; whoever has waited longest is told about it
    // without anyone at the shop having to notice. Best effort by construction.
    await offerFreedSlotToWaitlist({ db, business, appointment: cancelled });

    await enqueueCancellationNotifications({
      db,
      business,
      appointment: cancelled,
    });
  } catch (error) {
    reportError("cancel.notify", error, { appointmentId: cancelled.id });
  }

  revalidatePath(`/b/${token}`);
  return { ok: true };
}
