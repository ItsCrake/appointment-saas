import type { Metadata } from "next";

import { SettingsForm } from "@/components/dashboard/settings-form";
import { requireBusiness } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "הגדרות" };

export default async function SettingsPage() {
  const { business } = await requireBusiness();

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
          הגדרות
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          פרטי העסק וכללי קביעת התורים
        </p>
      </header>

      <SettingsForm
        business={{
          name: business.name,
          slug: business.slug,
          phone: business.phone ?? "",
          address: business.address ?? "",
          description: business.description ?? "",
          bufferMin: business.bufferMin,
          cancelWindowHours: business.cancelWindowHours,
          timezone: business.timezone,
        }}
      />
    </div>
  );
}
