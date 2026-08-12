import type { Metadata } from "next";

import { ClientsDirectory } from "@/components/dashboard/clients-directory";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { listClients } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";
import { formatFullDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "לקוחות" };

export default async function ClientsPage() {
  const { business } = await requireBusiness();
  const clients = await listClients(db, business.id);

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
        }))}
      />
    </div>
  );
}
