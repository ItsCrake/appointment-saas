import { fromZonedTime } from "date-fns-tz";

import type { AgendaAppointment } from "@/components/dashboard/agenda-list";
import { listAppointmentsInRange } from "@/db/queries";
import type { Business } from "@/db/schema";
import type { Database } from "@/db/types";
import { shiftDays } from "@/lib/calendar-week";

/**
 * One day of the agenda, as the list draws it.
 *
 * Shared by the page and by `/api/dashboard/day`, so the day the page renders
 * and the day the owner steps to without a navigation are the same query —
 * see `AgendaView`. Cancelled bookings are left out, as they always were here:
 * the agenda is what is happening, and the full calendar is where a
 * cancellation is drawn as the reason for a gap.
 *
 * Midnight to midnight in the shop's zone, so a DST night is the day it is
 * rather than a fixed 24 hours from its start.
 */
export async function loadAgendaDay(
  db: Database,
  business: Pick<Business, "id" | "timezone">,
  day: string,
): Promise<AgendaAppointment[]> {
  const from = fromZonedTime(`${day}T00:00:00`, business.timezone);
  const to = fromZonedTime(`${shiftDays(day, 1)}T00:00:00`, business.timezone);

  const rows = await listAppointmentsInRange(db, business.id, from, to, [
    "pending",
    "confirmed",
    "completed",
    "no_show",
  ]);

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    serviceName: row.serviceName,
    priceCents: row.priceCents,
    notes: row.notes,
  }));
}
