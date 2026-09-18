import {
  cancelPendingNotificationsForAppointment,
  deletePendingNotificationsForAppointment,
} from "@/db/queries/notifications";
import type { Appointment, Business } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  enqueueCancellationNotifications,
  enqueueRejectionNotifications,
  enqueueReminder,
} from "@/lib/notifications/enqueue";
import { reportError } from "@/lib/observability";
import { offerFreedSlotToWaitlist } from "@/lib/waitlist-offer";

/**
 * What a change to an appointment owes the people around it.
 *
 * ---------------------------------------------------------------------------
 * **One definition, because two copies already disagreed.** The dashboard's
 * actions re-planned a moved appointment's reminder and told a cancelled
 * client, while ליבי's spoken "כן" wrote the same change and did neither — so
 * an appointment she moved kept a reminder timed for the hour it had left, and
 * a client she cancelled was never told. Her *tap* button went through the
 * dashboard actions and did both, so the same card behaved differently
 * depending on whether the owner answered it with a finger or a word. Every
 * path that moves or cancels now ends here.
 *
 * **Never throws.** The change has already been written when these run, and an
 * owner told that a completed move failed will move it again. Failures are
 * reported under the caller's own name and swallowed, exactly as the actions
 * always did.
 *
 * **A voice placeholder costs nothing here.** It has no phone number, so every
 * enqueue below finds no recipient and queues nothing.
 * ---------------------------------------------------------------------------
 */

type Context = {
  db: Database;
  business: Business;
  /** Who is reporting, e.g. `"dashboard.reschedule"` or `"voice"`. */
  source: string;
};

/**
 * The reminder was scheduled for a time that no longer exists.
 *
 * Deleted and re-planned rather than skipped and re-enqueued: the dedupe key
 * does not mention the time, so a skipped row would swallow the new one — see
 * `deletePendingNotificationsForAppointment`. The client is not told the
 * appointment moved; that needs a template kind this system does not have.
 */
export async function afterAppointmentMoved({
  db,
  business,
  appointment,
  source,
}: Context & { appointment: Appointment }): Promise<void> {
  try {
    await deletePendingNotificationsForAppointment(db, appointment.id);
    await enqueueReminder({ db, business, appointment });
  } catch (error) {
    reportError(`${source}.notify`, error, { appointmentId: appointment.id });
  }
}

/**
 * The client is told, the queued messages stop, and the slot is offered on.
 *
 * `wasRequest` decides the wording: "התור שלך בוטל" is wrong for something
 * that was never confirmed, so a request that is turned down gets the
 * rejection instead. The freed slot goes to whoever has waited longest —
 * `offerFreedSlotToWaitlist` swallows its own failures.
 */
export async function afterAppointmentCancelled({
  db,
  business,
  appointment,
  wasRequest,
  source,
}: Context & { appointment: Appointment; wasRequest: boolean }): Promise<void> {
  try {
    await cancelPendingNotificationsForAppointment(db, appointment.id);
    await (wasRequest
      ? enqueueRejectionNotifications({ db, business, appointment })
      : enqueueCancellationNotifications({ db, business, appointment }));
    await offerFreedSlotToWaitlist({ db, business, appointment });
  } catch (error) {
    reportError(`${source}.notify`, error, {
      appointmentId: appointment.id,
      status: "cancelled",
    });
  }
}

/**
 * What one write left owing, as data — so a caller that cannot wait for it
 * can hand it to somebody who can. ליבי's route runs these after her answer
 * has been sent: the owner is standing there, and none of it changes what she
 * says.
 */
export type Aftermath =
  | { kind: "moved"; appointment: Appointment }
  | { kind: "cancelled"; appointment: Appointment; wasRequest: boolean };

export async function settleAftermath({
  db,
  business,
  source,
  owed,
}: Context & { owed: readonly Aftermath[] }): Promise<void> {
  for (const item of owed) {
    if (item.kind === "moved") {
      await afterAppointmentMoved({
        db,
        business,
        source,
        appointment: item.appointment,
      });
    } else {
      await afterAppointmentCancelled({
        db,
        business,
        source,
        appointment: item.appointment,
        wasRequest: item.wasRequest,
      });
    }
  }
}
