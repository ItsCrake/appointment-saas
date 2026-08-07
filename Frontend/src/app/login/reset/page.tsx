import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell, authLinkClass } from "@/components/dashboard/auth-shell";
import { ResetPasswordForm } from "@/components/dashboard/reset-password-form";
import { FormAlert } from "@/components/ui/form-alert";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "בחירת סיסמה חדשה",
  robots: { index: false, follow: false },
};

// Reads the session, so there is nothing here to prerender.
export const dynamic = "force-dynamic";

/**
 * Where the recovery link lands after `/auth/confirm` has exchanged it for a
 * session.
 *
 * The gate is simply "is there a session": a recovery link mints a full one, so
 * anyone holding it already has the account. A separate "this session came from
 * a recovery link" marker would look like a second factor while adding none —
 * it would gate a door that is already open.
 *
 * The consequence, stated rather than discovered: an owner who is *already*
 * signed in can reach this page and change their password without entering the
 * old one. Requiring re-authentication for that is a real product decision
 * (Supabase exposes a setting for it) and is deliberately not made here — the
 * page is not linked from anywhere inside the dashboard.
 */
export default async function ResetPasswordPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AuthShell
        title="הקישור אינו תקף"
        subtitle="ייתכן שהקישור פג תוקף, שכבר נעשה בו שימוש, או שנפתח בדפדפן אחר."
      >
        <div className="space-y-4">
          <FormAlert tone="error">
            כדי להמשיך צריך קישור חדש. הם תקפים לשעה אחת ולשימוש יחיד.
          </FormAlert>
          <p className="text-center text-sm">
            <Link href="/login/forgot" className={authLinkClass}>
              שליחת קישור חדש
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="בחירת סיסמה חדשה"
      subtitle={
        <>
          עבור <span dir="ltr">{user.email}</span>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
