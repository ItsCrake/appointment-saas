import type { Metadata } from "next";

import { Clock } from "lucide-react";

import { PageHeader } from "@/components/dashboard/ui";
import { HoursManager } from "@/components/dashboard/hours-manager";
import { db } from "@/db";
import { listUpcomingTimeOff, listWorkingHours } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "שעות פעילות" };

export default async function HoursPage() {
  const { business } = await requireBusiness();

  const [hours, timeOff] = await Promise.all([
    listWorkingHours(db, business.id),
    listUpcomingTimeOff(db, business.id, new Date()),
  ]);

  return (
    <div>
      <PageHeader
        icon={<Clock className="size-5" />}
        title="שעות פעילות"
        subtitle={`שעות קבועות וחסימות חד-פעמיות (${business.timezone})`}
      />

      <HoursManager
        timezone={business.timezone}
        shifts={hours
          .filter((h) => !h.isClosed)
          .map((h) => ({
            weekday: h.weekday,
            startTime: h.startTime.slice(0, 5),
            endTime: h.endTime.slice(0, 5),
          }))}
        timeOff={timeOff.map((t) => ({
          id: t.id,
          startsAt: t.startsAt.toISOString(),
          endsAt: t.endsAt.toISOString(),
          reason: t.reason,
        }))}
      />
    </div>
  );
}
