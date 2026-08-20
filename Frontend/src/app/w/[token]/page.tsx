import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WaitlistInvite } from "@/components/booking/waitlist-invite";
import { db } from "@/db";
import {
  getBusinessById,
  getWaitlistEntryByToken,
  listAppointmentsInRange,
} from "@/db/queries";
import { toThemeColor } from "@/lib/branding";
import { inviteStateFor } from "@/lib/waitlist";

export const metadata: Metadata = {
  title: "התפנה תור",
  robots: { index: false, follow: false },
};

/** The offer is live or it is not; a cached page would say the wrong one. */
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

/**
 * The slot a waitlist invite offers, and the one screen that has to be gracious
 * about losing.
 *
 * ---------------------------------------------------------------------------
 * **Whether the slot is still free is answered here, before anything is
 * shown.** The same link went to several people, so by the time somebody opens
 * it the answer may already be no — and the difference between a page that says
 * so warmly and one that lets them fill in a form before failing is the whole
 * experience of being on a waitlist.
 *
 * "Free" is asked of the appointments table rather than of the entry's own
 * status: the entry only learns it lost when *this* person tries to book, and
 * the honest question is whether anybody at all now holds that provider at that
 * time. `listAppointmentsInRange` defaults to the blocking statuses, which is
 * exactly the set the exclusion constraint enforces — so this page and the
 * insert that settles the race are asking the same question.
 * ---------------------------------------------------------------------------
 */
export default async function WaitlistInvitePage({ params }: PageProps) {
  const { token } = await params;

  const found = await getWaitlistEntryByToken(db, token);
  if (!found) notFound();

  const { entry, service, staffName } = found;
  const business = await getBusinessById(db, entry.businessId);
  if (!business) notFound();

  const startsAt = entry.invitedStartsAt;
  const endsAt = entry.invitedEndsAt;

  /**
   * Whether anybody now holds that provider at that time.
   *
   * Asked of the appointments table rather than of the entry's own status: the
   * entry only learns it lost when *this* person tries to book, and the honest
   * question is whether the slot is gone. `listAppointmentsInRange` defaults to
   * the blocking statuses, which is exactly the set the exclusion constraint
   * enforces — so this page and the insert that settles the race are asking the
   * same question.
   */
  let slotTaken = false;
  if (startsAt && endsAt && entry.status !== "booked") {
    const overlapping = await listAppointmentsInRange(
      db,
      business.id,
      startsAt,
      endsAt,
    );
    slotTaken = overlapping.some(
      (appointment) => appointment.staffId === entry.invitedStaffId,
    );
  }

  const state = inviteStateFor(entry, {
    businessIsActive: business.isActive,
    slotTaken,
  });

  return (
    // Themed like the shop's own page: somebody arriving from a WhatsApp
    // message is still looking at that business, and a page in a different
    // colour reads as a different company asking for their details.
    <div
      data-accent={toThemeColor(business.themeColor)}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 py-10"
    >
      <WaitlistInvite
        token={token}
        state={state}
        clientName={entry.clientName}
        businessName={business.name}
        businessSlug={business.slug}
        timezone={business.timezone}
        serviceName={service?.name ?? null}
        priceCents={service?.priceCents ?? null}
        staffName={staffName}
        startsAt={startsAt?.toISOString() ?? null}
      />
    </div>
  );
}
