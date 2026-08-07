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
      <div className="flex items-center justify-end border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-red-600"
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
      <nav className="hidden w-56 shrink-0 border-e border-zinc-200 bg-white px-3 py-6 md:block dark:border-zinc-800 dark:bg-zinc-900">
        <p className="px-3 pb-4 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          ניהול
        </p>
        <ul className="space-y-1">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
                  // The current page is the clearest "active" thing in the
                  // app, which is precisely what `/` spends its one gradient
                  // on. One filled item at a time, and nothing else here
                  // carries colour.
                  isActive(href)
                    ? "bg-[image:var(--brand-gradient)] text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
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
            className="text-sm font-medium text-zinc-500 hover:text-red-600"
            pendingLabel="מתנתק…"
          >
            <LogOut className="size-4" aria-hidden />
            התנתקות
          </SubmitButton>
        </form>
      </nav>

      {/* Mobile: settings + sign-out in a compact top bar. */}
      <div className="flex items-center justify-end gap-1 border-b border-zinc-200 bg-white px-3 py-2 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <Link
          href="/dashboard/settings"
          aria-label="הגדרות"
          aria-current={isActive("/dashboard/settings") ? "page" : undefined}
          className={cn(
            "rounded-lg p-2 transition-colors",
            isActive("/dashboard/settings")
              ? "text-zinc-950 dark:text-zinc-50"
              : "text-zinc-400",
          )}
        >
          <Settings className="size-5" />
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            aria-label="התנתקות"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:text-red-600"
          >
            <LogOut className="size-5" />
          </button>
        </form>
      </div>

      {/* Mobile: fixed bottom bar, thumb-reachable. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
        <ul className="grid grid-cols-4">
          {MOBILE_LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive(href)
                    ? "text-zinc-950 dark:text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
                )}
              >
                {/* The pill fills with the gradient and the icon inverts onto
                    it — the same "one active item" rule as the sidebar, at a
                    size where a tint alone would be too quiet to find. */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    isActive(href) &&
                      "bg-[image:var(--brand-gradient)] text-white",
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
