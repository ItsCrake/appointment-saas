import type { Metadata } from "next";
import { BellRing } from "lucide-react";

import { WaitlistManager } from "@/components/dashboard/waitlist-manager";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { listServices, listWaitlistEntries } from "@/db/queries";
import { listActiveStaff } from "@/db/queries/staff";
import { requireBusiness } from "@/lib/dashboard-session";
import { describePreferences } from "@/lib/waitlist";

export const metadata: Metadata = { title: "רשימת המתנה" };

/** The queue changes as people are invited and book; a cached page would lie. */
export const dynamic = "force-dynamic";

/**
 * Everybody waiting for a slot this shop cannot currently offer.
 *
 * `requireBusiness`, not `requireWritable` — a frozen tenant may read their own
 * queue, and the actions behind the buttons are what refuse the writes.
 *
 * Both live statuses are shown together rather than split into tabs: `notified`
 * is not a different kind of person, it is somebody who was offered a slot and
 * has not answered, and an owner scanning the list wants them in it.
 */
export default async function WaitlistPage() {
  const { business } = await requireBusiness();

  const [rows, services, staff] = await Promise.all([
    listWaitlistEntries(db, business.id),
    listServices(db, business.id),
    listActiveStaff(db, business.id),
  ]);

  return (
    <div>
      <PageHeader
        icon={<BellRing className="size-5" />}
        title="רשימת המתנה"
        subtitle="לקוחות שממתינים למועד שיתפנה"
      />

      <WaitlistManager
        entries={rows.map(({ entry, serviceName, staffName }) => ({
          id: entry.id,
          clientName: entry.clientName,
          clientPhone: entry.clientPhone,
          status: entry.status,
          serviceName,
          staffName,
          // Formatted on the server so the list reads the same before and after
          // hydration, whatever zone the owner's device is in.
          preferences: describePreferences({
            preferredDays: entry.preferredDays,
            preferredTimeWindow: entry.preferredTimeWindow,
          }),
          notes: entry.notes,
          waitingSince: entry.createdAt.toISOString(),
          notifiedAt: entry.invitedAt?.toISOString() ?? null,
        }))}
        services={services.map((service) => ({
          id: service.id,
          name: service.name,
        }))}
        staff={staff.map((member) => ({ id: member.id, name: member.name }))}
      />
    </div>
  );
}
