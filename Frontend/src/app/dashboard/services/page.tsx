import type { Metadata } from "next";

import { Scissors } from "lucide-react";

import { ServicesManager } from "@/components/dashboard/services-manager";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { listServices } from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "שירותים" };

export default async function ServicesPage() {
  const { business } = await requireBusiness();
  const services = await listServices(db, business.id, { activeOnly: false });

  return (
    <div>
      <PageHeader
        icon={<Scissors className="size-5" />}
        title="שירותים"
        subtitle="השירותים המוצגים בעמוד ההזמנות שלכם"
      />

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
          imageUrl: s.imageUrl,
          requiresApproval: s.requiresApproval,
        }))}
      />
    </div>
  );
}
