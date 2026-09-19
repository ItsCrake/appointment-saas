"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
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
  type LucideIcon,
} from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { BookingsPauseSwitch } from "@/components/dashboard/bookings-pause";
import { focusRing } from "@/components/dashboard/ui";
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
  { href: "/dashboard/waitlist", label: "רשימת המתנה", icon: BellRing },
  { href: "/dashboard/analytics", label: "אנליטיקס", icon: ChartColumn },
  { href: "/dashboard/staff", label: "צוות", icon: UserRound },
  { href: "/dashboard/billing", label: "חיוב", icon: CreditCard },
  { href: "/dashboard/settings", label: "הגדרות", icon: Settings },
] as const;

/**
 * The dock holds four destinations and the overflow bubble. Five spheres and
 * one lit pill is what a 390px phone fits without the current tab's name
 * truncating.
 */
const MOBILE_LINKS = LINKS.slice(0, 4);

/**
 * When the current tab's name gives way to ליבי.
 *
 * ---------------------------------------------------------------------------
 * **She sits on the dock's row now, not above it.** Her button used to float
 * `5rem` over the bottom edge at the end of the screen — directly over the
 * dock's last bubble and, while the owner scrolled, over whatever card was
 * passing: in the agenda that was a card's "הושלם". On the row beside the dock
 * nothing floats over the page but that one row, which the page's padding is
 * sized to clear.
 *
 * The row is the dock (four 48px spheres, the lit pill with its name, the
 * gaps and the band's own padding — 340px with the longest name) plus her 56px
 * and a 10px gap: 406px, inside a nav that keeps 12px each side. Narrower than
 * that, the current tab drops its name and becomes a lit sphere like the
 * others. A container query rather than a viewport one, so the arithmetic is
 * against the width the row actually has.
 * ---------------------------------------------------------------------------
 */
const DOCK_ROW_COMPACT = {
  tab: "@max-[25.5rem]/dock:gap-0 @max-[25.5rem]/dock:pe-1",
  label: "@max-[25.5rem]/dock:sr-only",
} as const;

/** Where ליבי's button docks on a phone — see `LibiAssistant`. */
export const LIBI_DOCK_SLOT_ID = "libi-dock-slot";

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
function MoreSheet({
  isActive,
  bookingsPaused,
  compact,
}: {
  isActive: (href: string) => boolean;
  /** Null where there is no switch to offer — see the layout. */
  bookingsPaused: boolean | null;
  /** The dock shares its row with ליבי — see `DOCK_ROW_COMPACT`. */
  compact: boolean;
}) {
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
      <DockTab
        as="button"
        label="עוד"
        icon={MoreHorizontal}
        active={holdsCurrentPage}
        compact={compact}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      />

      {/**
       * **Portalled to the body, and it has to be.** The trigger now lives in
       * the dock, and the dock is frosted glass: an element with a
       * `backdrop-filter` becomes the containing block for every `fixed`
       * descendant. Rendered in place, `fixed inset-0` meant "the dock's own
       * 48px box" — the sheet came out dock-wide, rising from the dock, its
       * scrim covering nothing and its frost sampling nothing. Measured in the
       * browser before this; the body is the only ancestor it can trust.
       */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <button
                type="button"
                aria-label="סגירה"
                tabIndex={-1}
                onClick={close}
                className="glass-scrim animate-frost absolute inset-0 cursor-default"
              />

              {/* The appointment sheet's glass, so everything that rises from
                  the bottom of this app is visibly the same material. */}
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="glass-sheet animate-glass-in relative w-full max-w-lg rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom)]"
              >
                <div
                  aria-hidden
                  className="mx-auto mt-3 h-1 w-10 rounded-full bg-zinc-400/50"
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
                    className={cn(
                      "glass-control -me-1 flex size-10 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-300",
                      focusRing,
                    )}
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                </div>

                {/* First in the sheet: on a phone this is the quickest way to
                    the pause, and the one thing here that changes something
                    rather than going somewhere. */}
                {bookingsPaused !== null ? (
                  <div className="px-3 pb-2">
                    <BookingsPauseSwitch
                      paused={bookingsPaused}
                      variant="sheet"
                    />
                  </div>
                ) : null}

                <ul className="flex flex-col gap-1 px-3 pb-2">
                  {SECONDARY_LINKS.map(({ href, label, icon }) => (
                    <li key={href}>
                      <RailLink
                        href={href}
                        label={label}
                        icon={icon}
                        active={isActive(href)}
                        // Belt and braces with the render-time reset above: tapping
                        // the link for the page you are already on changes no
                        // pathname, so nothing would close the sheet.
                        onClick={close}
                        size="lg"
                      />
                    </li>
                  ))}
                </ul>

                <div className="border-t border-zinc-900/8 px-3 py-2 dark:border-white/8">
                  <form action={signOutAction}>
                    <SubmitButton
                      className="flex w-full items-center gap-3 rounded-full py-2 ps-2 pe-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-300"
                      pendingLabel="מתנתק…"
                    >
                      <span className="glass-bubble flex size-10 shrink-0 items-center justify-center rounded-full">
                        <LogOut className="size-5" aria-hidden />
                      </span>
                      התנתקות
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * One tab of the phone's dock.
 *
 * ---------------------------------------------------------------------------
 * **A glass sphere when it is somewhere else, a lit pill when it is here.** The
 * current tab is the only one that spends width on its name: four spheres and
 * one pill fit a 390px phone with room, where five labelled tabs truncated.
 * Every sphere still carries its name as `aria-label` and `title`, so nothing is
 * icon-only to a screen reader or to a long press.
 *
 * The glow in the current tab is the brand gradient — the one "active" signal
 * the platform surfaces allow themselves, spent on exactly one thing.
 * ---------------------------------------------------------------------------
 */
function DockTab({
  as,
  href,
  label,
  icon: Icon,
  active,
  onClick,
  compact = false,
  ...rest
}: {
  as: "link" | "button";
  href?: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: () => void;
  /**
   * ליבי shares the row, so the current tab gives up its name when the row is
   * too narrow for both — see `DOCK_ROW_COMPACT`. The name stays for a screen
   * reader, and the page's own title says the same thing on screen.
   */
  compact?: boolean;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
}) {
  const className = cn(
    "flex h-12 items-center justify-center rounded-full",
    focusRing,
    active
      ? cn(
          "glass-bubble-active gap-2 ps-1 pe-4 text-[13px] font-semibold text-zinc-950",
          compact && DOCK_ROW_COMPACT.tab,
        )
      : "glass-bubble size-12 text-zinc-700 dark:text-zinc-200",
  );

  const content = active ? (
    <>
      <span className="glass-dock-glow flex size-10 shrink-0 items-center justify-center rounded-full text-white">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className={cn(compact && DOCK_ROW_COMPACT.label)}>{label}</span>
    </>
  ) : (
    <Icon className="size-5" aria-hidden />
  );

  if (as === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={className}
        {...rest}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href ?? "#"}
      aria-current={active ? "page" : undefined}
      aria-label={active ? undefined : label}
      title={label}
      className={className}
    >
      {content}
    </Link>
  );
}

/**
 * One row of the desktop rail and of the phone's overflow sheet: an icon in its
 * own glass bubble, then the name. The current page lifts into lit glass and
 * its bubble takes the brand glow.
 */
function RailLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
  size = "md",
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick?: () => void;
  size?: "md" | "lg";
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-full ps-1.5 pe-3 font-medium transition-colors",
        size === "lg" ? "py-2 text-sm" : "py-1.5 text-sm",
        focusRing,
        active
          ? "glass-bubble-active text-zinc-950"
          : "text-zinc-600 hover:bg-white/55 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-50",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          size === "lg" ? "size-10" : "size-8",
          active ? "glass-dock-glow text-white" : "glass-bubble",
        )}
      >
        <Icon className={size === "lg" ? "size-5" : "size-4"} aria-hidden />
      </span>
      <span className="flex-1">{label}</span>
      <LinkSpinner />
    </Link>
  );
}

export function DashboardNav({
  bookingsPaused = null,
  voice = false,
}: {
  /**
   * Whether online bookings are paused (0035), resolved by the layout. Null
   * where the switch has nothing to control: no business yet, or a frozen one.
   */
  bookingsPaused?: boolean | null;
  /** ליבי is on this dashboard, so the phone's dock keeps a place for her. */
  voice?: boolean;
}) {
  const pathname = usePathname();

  /**
   * The full calendar lives under `/dashboard/agenda` and is reached from the
   * agenda's own header, so it is "היומן" too: an owner looking at their week
   * should see the dock say where they are, not light nothing.
   */
  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === href || pathname.startsWith("/dashboard/agenda")
      : pathname.startsWith(href);

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
      {/* Desktop: a floating glass rail, pinned while the page scrolls.

          The current page is the clearest "active" thing in the app, which is
          precisely what `/` spends its one gradient on: here it is the glow in
          that row's bubble, and nothing else in the rail carries colour. */}
      <nav
        aria-label="ניווט ראשי"
        className="sticky top-0 hidden h-dvh w-60 shrink-0 self-start p-3 md:block"
      >
        <div className="glass-dock flex h-full flex-col rounded-[1.75rem] px-2 py-4">
          <p className="px-3 pb-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            ניהול
          </p>
          {/* At the top of the rail, above the destinations: the one control
              here that changes what clients can do, one click from any page. */}
          {bookingsPaused !== null ? (
            <div className="px-1 pb-3">
              <BookingsPauseSwitch paused={bookingsPaused} variant="rail" />
            </div>
          ) : null}
          <ul className="flex flex-col gap-1">
            {LINKS.map(({ href, label, icon }) => (
              <li key={href}>
                <RailLink
                  href={href}
                  label={label}
                  icon={icon}
                  active={isActive(href)}
                />
              </li>
            ))}
          </ul>

          <form action={signOutAction} className="mt-auto pt-4">
            <SubmitButton
              className="flex w-full items-center gap-3 rounded-full py-1.5 ps-1.5 pe-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-700 dark:text-zinc-400 dark:hover:text-red-300"
              pendingLabel="מתנתק…"
            >
              <span className="glass-bubble flex size-8 shrink-0 items-center justify-center rounded-full">
                <LogOut className="size-4" aria-hidden />
              </span>
              התנתקות
            </SubmitButton>
          </form>
        </div>
      </nav>

      {/* Mobile: the dock. One connected piece of glass floating over the
          page, thumb-reachable, with the overflow as its last bubble rather
          than a button in a header bar at the other end of the screen.

          Lifted clear of the iOS home indicator by `max(inset, 0.75rem)` — the
          inset where there is one, and a small float everywhere else, because a
          dock resting on the bezel reads as clipped rather than as floating.
          The inset only became real once `viewport-fit=cover` landed.

          `pointer-events-none` on the full-width strip and `auto` on the dock
          itself, so the gutters either side of it never swallow a tap meant for
          the page underneath.

          **The band is taller than its bubbles now.** It was 48px under 52px
          spheres, so the glass only showed in the 4px between them — on a busy
          agenda the dock read as five loose bubbles with the cards' buttons
          showing through the gaps. At 60px round 48px spheres the band is a
          visible capsule the tabs sit *in*, frosted harder and edged and lifted
          by `.glass-dock-float`, so the page passes behind one object. */}
      <nav
        aria-label="ניווט ראשי"
        className="@container/dock pointer-events-none fixed inset-x-0 bottom-0 z-20 flex items-center justify-center gap-2.5 px-3 pr-[max(env(safe-area-inset-right),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] pl-[max(env(safe-area-inset-left),0.75rem)] md:hidden"
      >
        {/* **The page fades out before it passes under the dock.** Cards used
            to scroll straight into the glass at full contrast, and a busy
            agenda read as the dock's own clutter. A band behind the dock —
            below it in the nav's stacking context, above the page — carries
            the page background up and a light blur that grows toward the
            bottom, so a card softens and disappears rather than being cut.
            It reaches 3rem above the dock; the page's own bottom padding
            already keeps the last card clear of it. See `.dock-fade`. */}
        <div
          aria-hidden
          className="dock-fade pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+3rem)]"
        />
        <ul className="glass-dock glass-dock-float pointer-events-auto flex h-15 items-center gap-1 rounded-full px-1.5">
          {MOBILE_LINKS.map(({ href, label, icon }) => (
            <li key={href}>
              <DockTab
                as="link"
                href={href}
                label={label}
                icon={icon}
                active={isActive(href)}
                compact={voice}
              />
            </li>
          ))}
          {/* Everything the dock cannot hold. Sign-out lives inside it — a
              destructive action one stray thumb away from the tabs is not
              where it belongs. */}
          <li>
            <MoreSheet
              isActive={isActive}
              bookingsPaused={bookingsPaused}
              compact={voice}
            />
          </li>
        </ul>

        {/* ליבי's place on the row. Her button is portalled in by
            `LibiAssistant`, which owns it — it lives in the layout, beside this
            nav rather than inside it, so a conversation survives navigation.
            Outside the glass band on purpose: an element with a backdrop
            filter would become the containing block of anything `fixed` she
            renders. */}
        {voice ? (
          <div
            id={LIBI_DOCK_SLOT_ID}
            className="pointer-events-auto flex shrink-0 empty:hidden"
          />
        ) : null}
      </nav>
    </>
  );
}
