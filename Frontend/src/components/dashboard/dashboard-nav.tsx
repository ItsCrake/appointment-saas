"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Clock,
  LogOut,
  Scissors,
  Settings,
  Users,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "היומן", icon: CalendarDays },
  { href: "/dashboard/services", label: "שירותים", icon: Scissors },
  { href: "/dashboard/hours", label: "שעות", icon: Clock },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
] as const;

/** The bottom bar only fits four; settings lives in the sidebar and header. */
const MOBILE_LINKS = LINKS.slice(0, 4);

export function DashboardNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

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
                  isActive(href)
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <form action={signOutAction} className="mt-6 px-3">
          <button
            type="submit"
            className="flex items-center gap-2 text-sm font-medium text-neutral-500 transition-colors hover:text-red-600"
          >
            <LogOut className="size-4" aria-hidden />
            התנתקות
          </button>
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
              ? "text-neutral-900 dark:text-neutral-100"
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
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95">
        <ul className="grid grid-cols-4">
          {MOBILE_LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  isActive(href)
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-400",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
