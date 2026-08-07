import type { Metadata } from "next";
import Link from "next/link";

import { MasterTabs } from "@/components/master/master-tabs";
import { BRAND_MARK } from "@/lib/brand";
import { requireSuperAdmin } from "@/lib/master-session";

export const metadata: Metadata = {
  title: "Command Center",
  // Never indexed, never cached: it lists every tenant on the platform.
  robots: { index: false, follow: false },
};

/**
 * Guarding in the layout covers every nested route at once, so a new tab
 * cannot be added without protection.
 *
 * It is not sufficient on its own, though: a client-side navigation between
 * tabs reuses the layout without re-running it, so each page repeats the check
 * and so does every action. The layout is the net, not the boundary.
 */
export default async function MasterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireSuperAdmin();

  return (
    <div dir="rtl" className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <Link href="/master" className="font-bold text-zinc-50">
              {BRAND_MARK.stem}
              <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">
                {BRAND_MARK.dot}
              </span>
            </Link>
            <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
              Command Center
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span dir="ltr" className="text-xs text-zinc-500">
              {admin.email}
            </span>
            <Link
              href="/dashboard"
              className="text-xs font-medium text-zinc-400 transition-colors hover:text-white"
            >
              ליציאה →
            </Link>
          </div>
        </div>

        <MasterTabs />
      </header>

      <main className="mx-auto w-full max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}
