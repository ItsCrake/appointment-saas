import { ShieldAlert } from "lucide-react";

import { stopImpersonationAction } from "@/app/master/actions";

/**
 * Shown on every dashboard screen while a super admin is viewing a tenant.
 *
 * Deliberately loud and non-dismissible. An impersonation session that looks
 * like an ordinary login is how support tooling causes incidents — the whole
 * point is that the operator cannot forget whose data is on screen.
 */
export function ImpersonationBanner({
  businessName,
}: {
  businessName: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
        <ShieldAlert className="size-4 shrink-0" aria-hidden />
        מצב תמיכה — אתם צופים בנתונים של {businessName}. כל פעולה תירשם על שם
        העסק.
      </p>
      <form action={stopImpersonationAction}>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg bg-amber-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-950 focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:outline-none dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
        >
          יציאה ממצב תמיכה
        </button>
      </form>
    </div>
  );
}
