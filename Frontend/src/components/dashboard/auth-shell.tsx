import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";

import { BRAND_MARK } from "@/lib/brand";

/**
 * Chrome shared by every credential screen — sign in, forgot password, choose a
 * new one.
 *
 * One component rather than three copies of the same header, for the reason
 * `dashboard/ui.tsx` exists: the three screens are seen back to back, in that
 * order, by someone who is already frustrated. A wordmark that shifts by four
 * pixels between them reads as having been redirected somewhere else, which is
 * the last thing a password-reset flow can afford to suggest.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white"
          >
            <span
              aria-hidden
              className="flex size-9 items-center justify-center rounded-2xl bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
            >
              <CalendarCheck className="size-5" />
            </span>
            {/* The stop is the one coloured mark on a credential screen, and it
                is the gradient rather than a flat hue — the same treatment the
                wordmark gets on `/`, so the two read as one product. */}
            <span className="text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              {BRAND_MARK.stemHe}
              <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">
                {BRAND_MARK.dot}
              </span>
            </span>
          </Link>

          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {subtitle}
            </p>
          ) : null}
        </header>

        {/* Card, so the form reads as one object rather than floating fields. */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </div>

        {footer ? (
          <div className="mt-5 text-center text-xs text-zinc-500">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The one link style the auth surface uses for a secondary route out.
 *
 * Underlined ink rather than a coloured link: with no accent hue, a link is
 * distinguished by weight and rule, the same way `/` does it.
 */
export const authLinkClass =
  "font-semibold text-zinc-950 underline underline-offset-2 decoration-zinc-300 hover:decoration-zinc-950 dark:text-zinc-50 dark:decoration-zinc-600 dark:hover:decoration-zinc-50";
