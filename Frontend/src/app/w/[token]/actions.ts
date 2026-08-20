"use server";

import { randomUUID } from "node:crypto";

import {
  createAppointment,
  getBusinessById,
  getService,
  getWaitlistEntryByToken,
  setWaitlistStatus,
  SlotTakenError,
} from "@/db/queries";
import { db } from "@/db";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import { enqueueBookingNotifications } from "@/lib/notifications/enqueue";
import { reportError } from "@/lib/observability";

export type ClaimResult =
  | { ok: true }
  /** Somebody else got there first. The one outcome this page exists to handle. */
  | { ok: false; taken: true }
  | { ok: false; taken?: false; error: string };

/**
 * Takes the slot an invite offered.
 *
 * ---------------------------------------------------------------------------
 * **The token is the credential**, exactly as it is on `/b/[token]`: the person
 * following this link has no account, and the link identifies both the offer
 * and the individual it went to. Everything else is re-derived here — the slot,
 * the provider, the service and the price all come from the entry and the
 * catalogue, never from the request, so a crafted payload cannot book a
 * different time or a cheaper service.
 *
 * **Availability is deliberately not re-run**, which is the one place this
 * differs from `createBookingAction`. The slot being offered was freed by a
 * cancellation and may sit outside posted hours, inside a break, or anywhere
 * else the engine would refuse — it was a real appointment minutes ago, and the
 * shop has explicitly offered it. What still holds is the guard that matters:
 * `appointments_no_overlap_staff` refuses a second booking on the same provider
 * and time, and **that is the whole race**. Several people hold this link; they
 * all pass every check; exactly one insert survives, and everybody else gets
 * `SlotTakenError` and the friendly screen.
 * ---------------------------------------------------------------------------
 */
export async function claimWaitlistSlotAction(
  token: string,
): Promise<ClaimResult> {
  if (typeof token !== "string" || token.length < 8) {
    return { ok: false, error: "הקישור אינו תקין" };
  }

  const found = await getWaitlistEntryByToken(db, token);
  if (!found) return { ok: false, error: "ההזמנה אינה זמינה יותר" };

  const { entry } = found;
  // Pulled onto locals so the null checks narrow the values actually used
  // below; checking them through the row leaves them nullable at the insert.
  const { invitedStartsAt, invitedEndsAt } = entry;
  if (!invitedStartsAt || !invitedEndsAt) {
    return { ok: false, error: "ההזמנה אינה זמינה יותר" };
  }

  if (entry.status === "booked") {
    // Their own second tap, not a race. Reported as success so the screen shows
    // the booking rather than telling them somebody stole a slot they hold.
    return { ok: true };
  }

  if (entry.status === "cancelled" || entry.status === "expired") {
    return { ok: false, error: "ההזמנה אינה זמינה יותר" };
  }

  if (invitedStartsAt.getTime() <= Date.now()) {
    return { ok: false, error: "המועד הזה כבר עבר" };
  }

  const business = await getBusinessById(db, entry.businessId);
  if (!business || !business.isActive) {
    return { ok: false, error: "העסק אינו זמין כרגע" };
  }

  if (!entry.invitedServiceId || !entry.invitedStaffId) {
    return { ok: false, error: "ההזמנה אינה זמינה יותר" };
  }

  const service = await getService(db, business.id, entry.invitedServiceId);
  if (!service) return { ok: false, error: "השירות אינו זמין" };

  try {
    const appointment = await createAppointment(db, {
      businessId: business.id,
      serviceId: service.id,
      staffId: entry.invitedStaffId,
      startsAt: invitedStartsAt,
      endsAt: invitedEndsAt,
      /**
       * Confirmed even in a shop that runs "תורים באישור". The owner chose to
       * offer this exact slot to this exact queue — the approval step exists to
       * let them vet a request, and they have already done that by inviting.
       */
      status: "confirmed",
      clientName: entry.clientName,
      clientPhone: entry.clientPhone,
      clientEmail: null,
      notes: entry.notes,
      serviceName: service.name,
      priceCents: service.priceCents,
      cancelToken: randomUUID(),
    });

    /**
     * Out of the queue, and the token retired in the same write.
     *
     * Both halves matter: `booked` is what stops the next cancellation offering
     * them another slot, and clearing the token is what stops this link being
     * followed again — by them, or by anyone it was forwarded to.
     */
    await setWaitlistStatus(db, entry.id, "booked", { clearInvite: true });

    try {
      const queued = await enqueueBookingNotifications({
        db,
        business,
        appointment,
      });
      if (queued.length > 0) {
        await dispatchDueNotifications(db, {
          appointmentId: appointment.id,
          limit: 10,
        });
      }
    } catch (error) {
      // The appointment exists. A message problem must never turn a booking
      // that worked into an error the client sees.
      reportError("waitlist.claim.notify", error, {
        businessId: business.id,
        appointmentId: appointment.id,
      });
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof SlotTakenError) {
      /**
       * The race, resolved. Their entry stays **active** rather than being
       * marked anything: they did not get this slot, so they have not left the
       * queue, and the next cancellation should find them exactly where they
       * were. The token is cleared so the dead link stops resolving.
       */
      await setWaitlistStatus(db, entry.id, "active", { clearInvite: true });
      return { ok: false, taken: true };
    }

    reportError("waitlist.claim", error, { entryId: entry.id });
    return { ok: false, error: "אירעה שגיאה. נסו שוב." };
  }
}
