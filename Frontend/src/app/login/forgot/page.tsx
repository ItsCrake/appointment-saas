import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, authLinkClass } from "@/components/dashboard/auth-shell";
import { ForgotPasswordForm } from "@/components/dashboard/forgot-password-form";
import { FormAlert } from "@/components/ui/form-alert";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "איפוס סיסמה",
  robots: { index: false, follow: false },
};

/** Why `/auth/confirm` bounced someone back here, in words they can act on. */
const LINK_ERRORS: Record<string, string> = {
  link: "הקישור פג תוקף או שכבר נעשה בו שימוש. בקשו קישור חדש למטה.",
  unconfigured: "איפוס הסיסמה אינו מוגדר בשרת. פנו אלינו לעזרה.",
};

type PageProps = { searchParams: Promise<{ error?: string }> };

export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const linkError = error ? LINK_ERRORS[error] : undefined;

  return (
    <AuthShell
      title="שכחתם סיסמה?"
      subtitle="הזינו את כתובת האימייל של החשבון ונשלח אליכם קישור לבחירת סיסמה חדשה."
      footer={
        <>
          עדיין אין לכם עסק במערכת?{" "}
          <Link href="/dashboard/setup" className={authLinkClass}>
            הקימו אותו בחמש דקות
          </Link>
        </>
      }
    >
      {!isSupabaseConfigured() ? (
        <FormAlert tone="error">
          ההתחברות אינה מוגדרת. חסרים מפתחות Supabase בהגדרות השרת.
        </FormAlert>
      ) : (
        <div className="space-y-4">
          {linkError ? <FormAlert tone="error">{linkError}</FormAlert> : null}
          <ForgotPasswordForm />
        </div>
      )}
    </AuthShell>
  );
}
