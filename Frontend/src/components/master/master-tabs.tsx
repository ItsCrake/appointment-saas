"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  LayoutDashboard,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/master", label: "סקירה", icon: LayoutDashboard },
  { href: "/master/businesses", label: "עסקים", icon: Building2 },
  { href: "/master/live", label: "פעילות בלייב", icon: Activity },
  { href: "/master/alerts", label: "התראות", icon: TriangleAlert },
] as const;

export function MasterTabs() {
  const pathname = usePathname();

  // Exact match for the index, prefix for the rest — otherwise "/master"
  // stays highlighted on every nested tab.
  const isActive = (href: string) =>
    href === "/master" ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="mx-auto w-full max-w-7xl px-5">
      <ul className="-mb-px flex [scrollbar-width:none] gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none",
                  // On ink there is no lighter step left to promote the active
                  // tab with, so the text carries the contrast and the rule
                  // carries the accent — indigo, the gradient's mid stop. A
                  // literal gradient on a 2px underline reads as a rendering
                  // artefact at this size.
                  active
                    ? "border-indigo-400 text-white"
                    : "border-transparent text-zinc-400 hover:text-zinc-100",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
