import { randomUUID } from "node:crypto";

import type { Appointment, Business } from "@/db/schema";
import {
  listWaitlistEntries,
  markWaitlistInvited,
} from "@/db/queries/waitlist";
import type { Database } from "@/db/types";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import { enqueueWaitlistInvite } from "@/lib/notifications/enqueue";
import { reportError } from "@/lib/observability";
import { matchesForSlot } from "@/lib/waitlist";

/**
 * A cancelled appointment offers its slot to the queue, by itself.
 *
 * ---------------------------------------------------------------------------
 * **Nothing asks the owner.** This used to be a banner on the dashboard with an
 * "offer it to the waitlist" button, which put a decision in front of somebody
 * for every single cancellation — and the decision was always yes. A queue whose
 * whole purpose is to fill gaps should not need permission to fill one; the
 * owner's job is deciding who is *in* the queue, which is what
 * `/dashboard/waitlist` is for.
 *
 * **One person, the one who has waited longest.** `matchesForSlot` sorts by
 * `created_at`, so the offer goes to the front of the queue rather than to
 * everybody at once. That is a deliberate change from the ten-at-a-time the
 * banner did: an automatic send that messages ten people every time anybody
 * cancels is a shop spending money on its own no-shows, and nine of those
 * messages exist only to be lost. The `/w/[token]` "already taken" screen still
 * earns its place — two cancellations can offer overlapping slots, and an owner
 * can fill one by hand while an invite is out.
 *
 * **Best effort, always.** Every caller is a cancellation that has already
 * happened. A queue that cannot be reached must never turn a completed
 * cancellation into an error the client or the owner sees, so this swallows
 * everything and reports it.
 * ---------------------------------------------------------------------------
 */
export async function offerFreedSlotToWaitlist({
  db,
  business,
  appointment,
  now = new Date(),
}: {
  db: Database;
  business: Business;
  /** The row **after** it was cancelled. */
  appointment: Appointment;
  now?: Date;
}): Promise<{ offeredTo: string | null }> {
  try {
    // A slot in the past is not an opening. Checked before the query, because
    // most cancellations of past appointments are just tidying up.
    if (appointment.startsAt.getTime() <= now.getTime()) {
      return { offeredTo: null };
    }

    const rows = await listWaitlistEntries(db, business.id);
    const matched = matchesForSlot(
      rows.map((row) => row.entry),
      {
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        staffId: appointment.staffId,
        serviceId: appointment.serviceId,
      },
      business.timezone,
    );

    const next = matched[0];
    if (!next) return { offeredTo: null };

    /**
     * A fresh token per offer, which retires any link this person was sent for
     * an earlier slot. An old link must never book a new opening.
     */
    const updated = await markWaitlistInvited(db, next.id, {
      inviteToken: randomUUID(),
      invitedStartsAt: appointment.startsAt,
      invitedEndsAt: appointment.endsAt,
      invitedStaffId: appointment.staffId,
      invitedServiceId: appointment.serviceId,
    });

    if (!updated) return { offeredTo: null };

    const queued = await enqueueWaitlistInvite({
      db,
      business,
      entry: updated,
      now,
    });

    if (queued.length > 0) {
      /**
       * Sent now rather than on the next sweep. An invite is the most
       * time-critical message the product has — the slot it describes is one
       * an owner would otherwise be filling by hand — and the sweep is up to
       * fifteen minutes away.
       */
      await dispatchDueNotifications(db, { limit: 5 });
    }

    return { offeredTo: updated.clientName };
  } catch (error) {
    reportError("waitlist.autoOffer", error, {
      businessId: business.id,
      appointmentId: appointment.id,
    });
    return { offeredTo: null };
  }
}
