"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChartColumn,
  Clock,
  CreditCard,
  Loader2,
  LogOut,
  MoreHorizontal,
  Scissors,
  Settings,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "היומן", icon: CalendarDays },
  { href: "/dashboard/services", label: "שירותים", icon: Scissors },
  { href: "/dashboard/hours", label: "שעות", icon: Clock },
  { href: "/dashboard/clients", label: "לקוחות", icon: Users },
  // Everything below is overflow on a phone. The bottom bar takes the first
  // four, and an owner reaches for their client list far more often than for
  // the roster or a chart.
  { href: "/dashboard/analytics", label: "אנליטיקס", icon: ChartColumn },
  { href: "/dashboard/staff", label: "צוות", icon: UserRound },
  { href: "/dashboard/billing", label: "חיוב", icon: CreditCard },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
] as const;

/** The bottom bar only fits four before the labels start truncating. */
const MOBILE_LINKS = LINKS.slice(0, 4);

/**
 * Everything the bottom bar could not take, **derived rather than listed**.
 *
 * That is the point. These two constants used to be a slice and a sidebar, and
 * the sidebar is `md:block` — so adding `/dashboard/staff` made it reachable on
 * a desktop and invisible on a phone, with nothing anywhere to notice. Deriving
 * the overflow from the same array means a new link can be added to `LINKS` and
 * is guaranteed to appear in exactly one of the two places.
 */
const SECONDARY_LINKS = LINKS.slice(MOBILE_LINKS.length);

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

/**
 * The mobile overflow menu.
 *
 * A bottom sheet rather than a dropdown from the header, for the same reason
 * the booking page's hours drawer is one: the trigger is at the top of a phone
 * and the thumb is at the bottom, so a menu that opens *downward from the
 * trigger* puts every item in the hardest part of the screen to reach.
 *
 * It closes on navigation — `pathname` changing is the signal, which also
 * covers a back gesture — on Escape, and on a backdrop tap.
 */
function MoreSheet({ isActive }: { isActive: (href: string) => boolean }) {
  const pathname = usePathname();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * A plain boolean, reset **during render** when the route changes.
   *
   * This used to derive open-ness from "the path I was opened on still
   * matches", which closed on navigation without an effect — and had a bug
   * that only shows on the way *back*. Open the sheet on `/dashboard`, tap a
   * link, then return to `/dashboard` from the bottom bar: the remembered path
   * matches again, so the sheet re-derives itself **open**, unprompted, on a
   * page the owner navigated to deliberately. That is the reported "it pops
   * open again", and no click handler could have fixed it because nothing was
   * being clicked.
   *
   * Adjusting state during render is React's own documented pattern for
   * resetting on a changed input. It is not a `setState` in an effect body, so
   * it does not trip the rule that shape was written to avoid — React discards
   * the in-progress render and re-runs this component immediately, before
   * anything commits or paints.
   */
  const [open, setOpen] = useState(false);
  const [renderedAt, setRenderedAt] = useState(pathname);

  if (renderedAt !== pathname) {
    setRenderedAt(pathname);
    setOpen(false);
  }

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    // Locked, or the page scrolls behind the sheet on iOS.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Marked when a page *inside* the sheet is the current one, so the trigger
  // does not read as inert while it holds the active route.
  const holdsCurrentPage = SECONDARY_LINKS.some((link) => isActive(link.href));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="עוד"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
          "focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:focus-visible:ring-white",
          holdsCurrentPage
            ? "bg-[image:var(--brand-gradient)] text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        )}
      >
        <MoreHorizontal className="size-4" aria-hidden />
        עוד
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            aria-label="סגירה"
            tabIndex={-1}
            onClick={close}
            className="animate-fade absolute inset-0 cursor-default bg-black/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="animate-sheet relative w-full max-w-lg rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl dark:bg-zinc-900"
          >
            <div
              aria-hidden
              className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700"
            />

            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2
                id={titleId}
                className="text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                עוד
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="סגירה"
                className="-me-2 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <ul className="px-3 pb-2">
              {SECONDARY_LINKS.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    // Belt and braces with the render-time reset above: tapping
                    // the link for the page you are already on changes no
                    // pathname, so nothing would close the sheet.
                    onClick={close}
                    aria-current={isActive(href) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-medium transition-colors",
                      isActive(href)
                        ? "bg-[image:var(--brand-gradient)] text-white"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <form action={signOutAction}>
                <SubmitButton
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
                  pendingLabel="מתנתק…"
                >
                  <LogOut className="size-5 shrink-0" aria-hidden />
                  התנתקות
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
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

      {/* Mobile: one entry point to everything the bottom bar cannot hold.
          Sign-out moved inside it — a destructive action sitting one stray
          thumb away from the header is not where it belongs. */}
      <div className="flex items-center justify-end border-b border-zinc-200 bg-white px-3 py-2 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <MoreSheet isActive={isActive} />
      </div>

      {/* Mobile: fixed bottom bar, thumb-reachable.

          The bottom padding lifts the tap targets clear of the iOS home
          indicator while the bar's own background still runs to the physical
          edge — a bar that stopped short would show a strip of page scrolling
          underneath it. It only started working when `viewport-fit=cover`
          landed; before that `env(safe-area-inset-bottom)` was `0px` and the
          indicator sat on top of the middle two tabs.

          `max(…, 0.25rem)` because a bar flush against the bezel on a device
          with no inset reads as clipped rather than as full-bleed.

          The horizontal insets matter only in landscape on a notched phone.
          The manifest locks the installed app to portrait, so this is for the
          same page opened in Safari, where nothing locks anything. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pr-[env(safe-area-inset-right)] pb-[max(env(safe-area-inset-bottom),0.25rem)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
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
