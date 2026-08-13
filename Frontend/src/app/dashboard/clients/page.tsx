import type { Metadata } from "next";

import { ClientsDirectory } from "@/components/dashboard/clients-directory";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { listClients, mapClientNotes } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import { formatFullDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "לקוחות" };

export default async function ClientsPage() {
  const { business } = await requireBusiness();
  // One extra query for the whole list — a marker per row, not the text. The
  // notes themselves load with the drawer.
  const [clients, notesByPhone] = await Promise.all([
    listClients(db, business.id),
    mapClientNotes(db, business.id),
  ]);

  return (
    <div>
      <PageHeader title="לקוחות" subtitle="מתוך היסטוריית התורים" />

      <ClientsDirectory
        clients={clients.map((client) => ({
          clientPhone: client.clientPhone,
          clientName: client.clientName,
          bookings: client.bookings,
          // Formatted on the server in the business timezone: doing it in the
          // client component would render a different string before and after
          // hydration for anyone whose device is in another zone.
          //
          // Null is a real answer — booked but never actually been in — and it
          // says so rather than borrowing a cancelled or future date.
          lastVisitDate: client.lastVisit
            ? formatFullDateTime(
                client.lastVisit.toISOString(),
                business.timezone,
              ).date
            : null,
          hasNotes: notesByPhone.has(client.clientPhone),
        }))}
      />
    </div>
  );
}
