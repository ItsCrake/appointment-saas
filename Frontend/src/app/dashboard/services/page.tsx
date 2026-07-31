import type { Metadata } from "next";

import { ServicesManager } from "@/components/dashboard/services-manager";
import { db } from "@/db";
import { listServices } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "שירותים" };

export default async function ServicesPage() {
  const { business } = await requireBusiness();
  const services = await listServices(db, business.id, { activeOnly: false });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          שירותים
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          השירותים המוצגים בעמוד ההזמנות שלכם
        </p>
      </header>

      <ServicesManager
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMin: s.durationMin,
          priceCents: s.priceCents,
          sortOrder: s.sortOrder,
          isActive: s.isActive,
          bufferMin: s.bufferMin,
          currency: s.currency,
        }))}
      />
    </div>
  );
}
