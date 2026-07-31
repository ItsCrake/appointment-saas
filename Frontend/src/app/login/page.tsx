import type { Metadata } from "next";

import { LoginForm } from "@/components/dashboard/login-form";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "כניסת בעלי עסקים",
  robots: { index: false, follow: false },
};

type PageProps = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: PageProps) {
  const { next } = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <h1 className="text-lg font-bold text-amber-900 dark:text-amber-100">
            ההתחברות אינה מוגדרת
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
            יש להגדיר את <code>NEXT_PUBLIC_SUPABASE_URL</code> ואת{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> בקובץ{" "}
            <code>.env.local</code> ולהפעיל מחדש את השרת.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            כניסת בעלי עסקים
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            ניהול התורים, השירותים ושעות הפעילות
          </p>
        </header>

        <LoginForm next={next} />
      </div>
    </main>
  );
}
