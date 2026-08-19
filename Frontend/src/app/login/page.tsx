import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, authLinkClass } from "@/components/dashboard/auth-shell";
import { LoginForm } from "@/components/dashboard/login-form";
import { FormAlert } from "@/components/ui/form-alert";
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
      <AuthShell title="ההתחברות אינה מוגדרת">
        <FormAlert tone="error">
          יש להגדיר את <code>NEXT_PUBLIC_SUPABASE_URL</code> ואת{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> בקובץ{" "}
          <code>.env.local</code> ולהפעיל מחדש את השרת.
        </FormAlert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="כניסת בעלי עסקים"
      subtitle={
        <>
          ניהול התורים, השירותים ושעות הפעילות ב־{BRAND_MARK.stemHe}
          <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">
            {BRAND_MARK.dot}
          </span>
        </>
      }
      footer={
        <>
          עדיין אין לכם עסק במערכת?{" "}
          <Link href="/dashboard/setup" className={authLinkClass}>
            הקימו אותו בחמש דקות
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthShell>
  );
}
