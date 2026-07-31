import type { Metadata } from "next";

import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { ToastProvider } from "@/components/ui/toast";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: { default: "ניהול", template: "%s · ניהול" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <h1 className="text-lg font-bold text-amber-900 dark:text-amber-100">
            לוח הניהול אינו מוגדר
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
            יש להוסיף את מפתחות Supabase לקובץ <code>.env.local</code> ולהפעיל
            מחדש את השרת.
          </p>
        </div>
      </main>
    );
  }

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-1 flex-col bg-neutral-50 md:flex-row dark:bg-neutral-950">
        <DashboardNav />
        {/* pb-24 clears the mobile bottom bar; md restores normal padding. */}
        <main className="flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-10">
          <div className="mx-auto w-full max-w-4xl">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
