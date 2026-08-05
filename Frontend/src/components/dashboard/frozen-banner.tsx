import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * Shown on every dashboard screen while the tenant is frozen.
 *
 * Non-dismissible, like the impersonation banner and for the same reason: the
 * dashboard still renders in full, so without it an owner would simply find
 * that saving silently does nothing and conclude the product is broken.
 *
 * It says what still works, not only what does not. A frozen account keeps its
 * data and its history; only writes and new bookings are stopped. Leading with
 * the loss would make "export and leave" the obvious next move.
 */
export function FrozenBanner({ reason }: { reason: string | null }) {
  const billing = reason === "billing";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-500/40 bg-rose-500/10 px-4 py-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-rose-900 dark:text-rose-200">
        <Lock className="size-4 shrink-0" aria-hidden />
        {billing
          ? "החשבון מוקפא עקב אי-תשלום. הנתונים והיומן נשמרים, אך לא ניתן לערוך ולא ניתן לקבוע תורים חדשים."
          : "החשבון מוקפא. הנתונים והיומן נשמרים, אך לא ניתן לערוך כרגע."}
      </p>

      {billing ? (
        <Link
          href="/dashboard/billing"
          className="inline-flex h-8 items-center rounded-full bg-rose-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-rose-950 focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:outline-none dark:bg-rose-200 dark:text-rose-950 dark:hover:bg-rose-100"
        >
          הסדרת תשלום
        </Link>
      ) : (
        // An admin freeze has no self-service route out, so offering a billing
        // button would send the owner somewhere that cannot help them.
        <span className="text-xs text-rose-900/80 dark:text-rose-200/80">
          לפרטים נוספים יש לפנות לתמיכה
        </span>
      )}
    </div>
  );
}
