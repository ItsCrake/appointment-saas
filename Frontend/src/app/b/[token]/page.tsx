import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ManageBooking } from "@/components/booking/manage-booking";
import { db } from "@/db";
import { getAppointmentContextByToken } from "@/db/queries";
import { toThemeColor } from "@/lib/branding";
import { getCancellationState } from "@/lib/cancellation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ניהול התור שלי",
  // A booking link should never end up in a search index.
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function ManageBookingPage({ params }: PageProps) {
  const { token } = await params;

  const row = await getAppointmentContextByToken(db, token);
  if (!row) notFound();

  const { appointment, business } = row;
  const state = getCancellationState(appointment, business.cancelWindowHours);

  return (
    // Themed like the booking page it came from. A client arriving here from a
    // confirmation message is still looking at that shop, and a page in a
    // different colour reads as a different company asking about their booking.
    <div
      data-accent={toThemeColor(business.themeColor)}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 py-10"
    >
      <ManageBooking
        token={token}
        appointment={{
          id: appointment.id,
          status: appointment.status,
          serviceName: appointment.serviceName,
          priceCents: appointment.priceCents,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          clientName: appointment.clientName,
          clientPhone: appointment.clientPhone,
          notes: appointment.notes,
        }}
        business={{
          name: business.name,
          slug: business.slug,
          timezone: business.timezone,
          phone: business.phone,
          address: business.address,
          cancelWindowHours: business.cancelWindowHours,
        }}
        canCancel={state.canCancel}
        isPast={state.isPast}
      />
    </div>
  );
}
