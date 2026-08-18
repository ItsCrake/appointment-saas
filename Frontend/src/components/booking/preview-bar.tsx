import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";

/**
 * The way back, for an owner looking at their own public page.
 *
 * ---------------------------------------------------------------------------
 * **Rendered only after the server has proved the viewer owns this shop.** The
 * `?preview=1` parameter expresses intent; it grants nothing. A query string is
 * guessable, and a client who landed on one showing a "back to dashboard"
 * button would be looking at a control that is not theirs and does not work.
 *
 * The check costs a Supabase round trip, so it is only run when the parameter
 * is present. `/[slug]` is the highest-traffic route in the product and the
 * proxy deliberately avoids paying for `getUser()` there — a real client's page
 * load is unchanged by this file existing.
 *
 * Sticky rather than fixed: the booking flow already owns the viewport on a
 * phone, and a fixed bar would sit on top of the first step.
 * ---------------------------------------------------------------------------
 */
export function PreviewBar({ businessName }: { businessName: string }) {
  return (
    <div className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 text-zinc-100 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <Eye className="size-4 shrink-0 text-zinc-400" aria-hidden />
          <span className="truncate">
            תצוגה מקדימה של <span className="font-bold">{businessName}</span>
          </span>
        </p>

        <Link
          href="/dashboard"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-900 transition-colors hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
        >
          חזרה לניהול
          <ArrowLeft className="size-3.5" aria-hidden />
        </Link>
      </div>

      {/* Says outright that a booking made here is real. The page below is the
          live one, not a sandbox, and an owner testing the flow will create an
          actual appointment in their own calendar. */}
      <p className="border-t border-zinc-800/70 px-4 py-1.5 text-center text-[11px] text-zinc-400">
        זהו העמוד האמיתי — תור שתקבעו כאן ייכנס ליומן שלכם
      </p>
    </div>
  );
}
