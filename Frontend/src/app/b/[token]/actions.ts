"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  cancelAppointmentByToken,
  getAppointmentContextByToken,
} from "@/db/queries";
import { getCancellationState } from "@/lib/cancellation";

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

  revalidatePath(`/b/${token}`);
  return { ok: true };
}
