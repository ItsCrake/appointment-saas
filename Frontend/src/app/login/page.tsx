import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { LoginForm } from "@/components/dashboard/login-form";
import { BRAND_MARK } from "@/lib/brand";
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
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-xl bg-teal-700 text-white"
            >
              <CalendarCheck className="size-5" />
            </span>
            <span className="font-bold text-neutral-900 dark:text-neutral-50">
              {BRAND_MARK.stem}
              <span className="text-teal-500">{BRAND_MARK.dot}</span>
            </span>
          </Link>

          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            כניסת בעלי עסקים
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            ניהול התורים, השירותים ושעות הפעילות ב־{BRAND_MARK.stem}
            <span className="text-teal-600 dark:text-teal-400">
              {BRAND_MARK.dot}
            </span>
          </p>
        </header>

        {/* Card, so the form reads as one object rather than floating fields. */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <LoginForm next={next} />
        </div>

        <p className="mt-5 text-center text-xs text-neutral-500">
          עדיין אין לכם עסק במערכת?{" "}
          <Link
            href="/dashboard/setup"
            className="font-semibold text-teal-800 underline-offset-2 hover:underline dark:text-teal-300"
          >
            הקימו אותו בחמש דקות
          </Link>
        </p>
      </div>
    </main>
  );
}
