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
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              {subtitle}
            </p>
          ) : null}
        </header>

        {/* Card, so the form reads as one object rather than floating fields. */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {children}
        </div>

        {footer ? (
          <div className="mt-5 text-center text-xs text-neutral-500">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** The one link style the auth surface uses for a secondary route out. */
export const authLinkClass =
  "font-semibold text-teal-800 underline-offset-2 hover:underline dark:text-teal-300";
