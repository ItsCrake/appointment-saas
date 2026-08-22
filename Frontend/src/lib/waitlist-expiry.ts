import { listNotifiedWaitlistOffers, setWaitlistStatus } from "@/db/queries";
import type { Database } from "@/db/types";
import { reportError } from "@/lib/observability";
import { offerHasLapsed } from "@/lib/waitlist";
import { offerSlotToWaitlist } from "@/lib/waitlist-offer";

export type WaitlistExpirySummary = {
  /** Offers that ran out of time this run. */
  expired: number;
  /** How many of those slots found a next person to go to. */
  reoffered: number;
};

/**
 * Lapsed invites leave the queue, and their slots go to whoever is next (0025).
 *
 * ---------------------------------------------------------------------------
 * **The gap this closes.** An invite used to be forever. The entry sat at
 * `notified`, its token stayed live, and if the invited client never answered
 * then the opening reached its own start time unsold — with a queue behind it
 * that was never told. Nothing in the product noticed, because nothing was
 * looking.
 *
 * **Why the lapsed entry becomes `expired` rather than going back to
 * `active`.** It is what stops the cycle looping. `entryMatchesSlot` accepts
 * only `active` and `notified`, so an expired entry is invisible to the very
 * next `matchesForSlot` call — the one made three lines below, for the same
 * slot. Without a terminal status the sweep would hand the slot straight back
 * to the person who just let it go, forever. The alternative was a column
 * recording which slot each entry had already declined; a status the schema
 * already has does the same work and needs no migration to read.
 *
 * The cost is real and worth stating: **missing one message costs a client
 * their place in the queue.** That is a deliberate choice, not an oversight,
 * and it is why the window defaults to a generous hour rather than to minutes.
 *
 * **The token is deliberately *not* cleared.** Every other exit from the queue
 * clears it, because there the link has either been used or been withdrawn.
 * Here the client is about to tap a link they were sent an hour ago, and a
 * cleared token makes `getWaitlistEntryByToken` return nothing — which
 * `/w/[token]` renders as a 404. Keeping it means the page resolves and shows
 * the gracious "this has expired" screen instead. The token is inert either
 * way: `claimWaitlistSlotAction` refuses an entry whose status is `expired`.
 *
 * **Correctness does not depend on this running.** `inviteStateFor` and the
 * claim action both check the deadline against the clock, so an offer is dead
 * on time whether or not the cron has been by. What the sweep adds is
 * *progress* — moving the slot on to somebody who can still use it — and that
 * genuinely cannot happen without a server-side pass.
 *
 * **Best effort per entry.** One tenant whose re-offer throws must not stop the
 * rest of the run, so each is wrapped and reported. `offerSlotToWaitlist`
 * already swallows its own failures; this catches the status write too.
 * ---------------------------------------------------------------------------
 */
export async function runWaitlistOfferExpirySweep(
  db: Database,
  { now = new Date() }: { now?: Date } = {},
): Promise<WaitlistExpirySummary> {
  const summary: WaitlistExpirySummary = { expired: 0, reoffered: 0 };

  const live = await listNotifiedWaitlistOffers(db);

  for (const { entry, business } of live) {
    if (!offerHasLapsed(entry, business.waitlistOfferTtlMin, now)) continue;

    try {
      await setWaitlistStatus(db, entry.id, "expired");
      summary.expired++;

      /**
       * The slot is rebuilt from the entry's own `invited_*` columns rather
       * than from an appointment, because there is no appointment — it was
       * cancelled, which is what freed the slot in the first place. Those
       * columns are the only surviving record of what was offered, which is
       * why they are copied onto the entry at invite time.
       */
      if (!entry.invitedStartsAt || !entry.invitedEndsAt) continue;
      if (!entry.invitedStaffId || !entry.invitedServiceId) continue;

      const { offeredTo } = await offerSlotToWaitlist({
        db,
        business,
        slot: {
          startsAt: entry.invitedStartsAt,
          endsAt: entry.invitedEndsAt,
          staffId: entry.invitedStaffId,
          serviceId: entry.invitedServiceId,
        },
        now,
        /**
         * The cron dispatches immediately after this sweep returns — the same
         * ordering `sweepSubscriptions` and `runRetentionSweep` rely on — so
         * pushing the outbox here would only re-read a queue that is about to
         * be read anyway.
         */
        dispatchNow: false,
      });

      if (offeredTo) summary.reoffered++;
    } catch (error) {
      reportError("waitlist.expirySweep", error, {
        businessId: business.id,
        entryId: entry.id,
      });
    }
  }

  return summary;
}
