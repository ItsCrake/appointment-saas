import type { Metadata } from "next";

import { db } from "@/db";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { FrozenBanner } from "@/components/dashboard/frozen-banner";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { ToastProvider } from "@/components/ui/toast";
import { VoiceAssistant } from "@/components/dashboard/voice-assistant";
import { getBusinessById } from "@/db/queries";
import { businessForOwner } from "@/lib/dashboard-session";
import { readImpersonatedBusinessId } from "@/lib/impersonation";
import { currentSuperAdmin } from "@/lib/master-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isVoiceConfigured } from "@/lib/voice/bazman-config";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: { default: "ניהול", template: "%s · ניהול" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Resolves the impersonation banner independently of `requireBusiness()`.
 * The layout renders around routes that redirect (setup), so it must not
 * itself depend on a resolved business.
 */
async function impersonatedName(): Promise<string | null> {
  const id = await readImpersonatedBusinessId();
  if (!id) return null;

  // Same re-check as requireBusiness: the cookie alone proves nothing.
  const admin = await currentSuperAdmin();
  if (!admin) return null;

  const business = await getBusinessById(db, id);
  return business?.name ?? null;
}

/**
 * Freeze state for the banner, resolved the same way and for the same reason:
 * this layout wraps routes that redirect, so it cannot call
 * `requireBusiness()` without fighting them.
 *
 * The banner is only an explanation. `requireWritable()` is what actually
 * refuses the write, so a missing banner is a confusing screen, never an open
 * door.
 */
async function frozenState(): Promise<{ reason: string | null } | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const impersonatedId = await readImpersonatedBusinessId();
  const business = impersonatedId
    ? (await currentSuperAdmin())
      ? await getBusinessById(db, impersonatedId)
      : null
    : // Shared with the page's `requireBusiness()` rather than a second
      // identical query — see `businessForOwner`.
      await businessForOwner(user.id);

  if (!business || business.isActive) return null;
  return { reason: business.frozenReason };
}

export default async function DashboardLayout({
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

  const [supportingBusiness, frozen] = await Promise.all([
    impersonatedName(),
    frozenState(),
  ]);

  const voiceReady = isVoiceConfigured();

  return (
    <ToastProvider>
      {supportingBusiness ? (
        <ImpersonationBanner businessName={supportingBusiness} />
      ) : null}
      {frozen ? <FrozenBanner reason={frozen.reason} /> : null}
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 md:flex-row dark:bg-zinc-950">
        <DashboardNav />
        {/* Clears the mobile bottom bar, which is 4rem of tabs plus whatever
            the home indicator claims — 6rem alone left the last row of a long
            page tucked under it on an iPhone once the inset became real. `md`
            restores normal padding, where the bar does not exist. */}
        <main className="flex-1 px-4 pt-6 pb-[calc(6rem_+_env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          <div className="mx-auto w-full max-w-4xl">{children}</div>
        </main>
      </div>

      {/* In the layout rather than on a page, because the ring is a property of
          the whole viewport and the microphone should not disappear when the
          owner navigates mid-thought.

          Resolved on the server: `isVoiceConfigured` reads a key with no
          `NEXT_PUBLIC_` prefix, so asking in the browser would always answer
          no. Absent rather than disabled when unconfigured — the same rule
          Libi follows. */}
      {voiceReady ? <VoiceAssistant /> : null}
    </ToastProvider>
  );
}
