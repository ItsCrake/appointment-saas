import type { Metadata } from "next";
import { formatInTimeZone } from "date-fns-tz";

import { db } from "@/db";
import { listUpcomingTimeOff } from "@/db/queries";
import { listAllStaff, listSchedulesForStaff } from "@/db/queries/staff";
import { MultiStaffToggle } from "@/components/dashboard/multi-staff-toggle";
import {
  StaffManager,
  type StaffRow,
  type StaffTimeOffRow,
} from "@/components/dashboard/staff-manager";
import { PageHeader } from "@/components/dashboard/ui";
import { requireBusiness } from "@/lib/dashboard-session";
import { todayInTimezone } from "@/lib/format";

export const metadata: Metadata = { title: "צוות" };

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  // `requireBusiness`, not `requireWritable`: a frozen tenant may read their
  // roster. The actions are what refuse the writes.
  const { business } = await requireBusiness();

  const staff = await listAllStaff(db, business.id);

  // One query per person, but the roster is small by construction — a shop with
  // forty barbers is not the product. Batching would need a join returning a
  // row per shift, which is more machinery than this page earns.
  const schedules = await Promise.all(
    staff.map((member) => listSchedulesForStaff(db, member.id)),
  );

  const rows: StaffRow[] = staff.map((member, i) => ({
    id: member.id,
    name: member.name,
    title: member.title,
    phone: member.phone,
    color: member.color,
    isActive: member.isActive,
    shifts: schedules[i].map((shift) => ({
      weekday: shift.weekday,
      startTime: shift.startTime,
      endTime: shift.endTime,
    })),
  }));

  const timeOff = await listUpcomingTimeOff(db, business.id, new Date());

  // Formatted here rather than in the client component: the business timezone
  // is a server fact, and rendering a date in the browser's zone would show an
  // owner in a different country the wrong day.
  const timeOffRows: StaffTimeOffRow[] = timeOff.map((row) => ({
    id: row.id,
    staffId: row.staffId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    label: `${formatInTimeZone(row.startsAt, business.timezone, "d.M.yyyy HH:mm")} – ${formatInTimeZone(row.endsAt, business.timezone, "HH:mm")}`,
  }));

  return (
    <div>
      <PageHeader
        title="צוות"
        subtitle="מי נותן את השירות, מתי הם עובדים ומתי הם לא"
      />

      <MultiStaffToggle enabled={business.hasMultipleStaff} />

      <div className="mt-6">
        <StaffManager
          staff={rows}
          timeOff={timeOffRows}
          today={todayInTimezone(business.timezone)}
        />
      </div>
    </div>
  );
}
