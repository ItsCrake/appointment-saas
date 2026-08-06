"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Clock,
  CreditCard,
  Loader2,
  LogOut,
  Scissors,
  Settings,
  Users,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "היומן", icon: CalendarDays },
  { href: "/dashboard/services", label: "שירותים", icon: Scissors },
  { href: "/dashboard/hours", label: "שעות", icon: Clock },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users },
  { href: "/dashboard/billing", label: "חיוב", icon: CreditCard },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
] as const;

/** The bottom bar only fits four; billing and settings live in the sidebar. */
const MOBILE_LINKS = LINKS.slice(0, 4);

/**
 * Covers the gap the route fallback cannot: the moment between the click and
 * the loading skeleton painting, while the RSC payload is still in flight.
 *
 * Must be a descendant of the `<Link>` it reports on, which is why it is its
 * own component. Always rendered and only faded, so nothing reflows when it
 * appears — an inline indicator that changes layout is worse than none.
 */
function LinkSpinner() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 animate-spin transition-opacity duration-150",
        pending ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

export function DashboardNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  // During onboarding every other section redirects back here, so a full nav
  // would be a set of dead ends. Offer only a way out.
  if (pathname.startsWith("/dashboard/setup")) {
    return (
      <div className="flex items-center justify-end border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:text-red-600"
          >
            <LogOut className="size-4" aria-hidden />
            התנתקות
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: persistent sidebar. */}
      <nav className="hidden w-56 shrink-0 border-e border-neutral-200 bg-white px-3 py-6 md:block dark:border-neutral-800 dark:bg-neutral-900">
        <p className="px-3 pb-4 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          ניהול
        </p>
        <ul className="space-y-1">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:outline-none",
                  isActive(href)
                    ? "bg-teal-700 text-white shadow-sm"
                    : "text-neutral-600 hover:bg-teal-50 hover:text-teal-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-teal-300",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1">{label}</span>
                <LinkSpinner />
              </Link>
            </li>
          ))}
        </ul>

        <form action={signOutAction} className="mt-6 px-3">
          <SubmitButton
            className="text-sm font-medium text-neutral-500 hover:text-red-600"
            pendingLabel="מתנתק…"
          >
            <LogOut className="size-4" aria-hidden />
            התנתקות
          </SubmitButton>
        </form>
      </nav>

      {/* Mobile: settings + sign-out in a compact top bar. */}
      <div className="flex items-center justify-end gap-1 border-b border-neutral-200 bg-white px-3 py-2 md:hidden dark:border-neutral-800 dark:bg-neutral-900">
        <Link
          href="/dashboard/settings"
          aria-label="הגדרות"
          aria-current={isActive("/dashboard/settings") ? "page" : undefined}
          className={cn(
            "rounded-lg p-2 transition-colors",
            isActive("/dashboard/settings")
              ? "text-teal-700 dark:text-teal-300"
              : "text-neutral-400",
          )}
        >
          <Settings className="size-5" />
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            aria-label="התנתקות"
            className="rounded-lg p-2 text-neutral-400 transition-colors hover:text-red-600"
          >
            <LogOut className="size-5" />
          </button>
        </form>
      </div>

      {/* Mobile: fixed bottom bar, thumb-reachable. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
        <ul className="grid grid-cols-4">
          {MOBILE_LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive(href)
                    ? "text-teal-700 dark:text-teal-300"
                    : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    isActive(href) && "bg-teal-50 dark:bg-teal-950/60",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
