import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetupForm } from "@/components/dashboard/setup-form";
import { db } from "@/db";
import { getBusinessByOwner } from "@/db/queries";
import { requireUser } from "@/lib/dashboard-session";

export const metadata: Metadata = { title: "הקמת העסק" };

export default async function SetupPage() {
  const user = await requireUser();

  const existing = await getBusinessByOwner(db, user.id);
  if (existing) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-md">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
          הקמת העסק שלכם
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          פרטים בסיסיים כדי להתחיל. אפשר לשנות הכול אחר כך.
        </p>
      </header>

      <SetupForm />
    </div>
  );
}
