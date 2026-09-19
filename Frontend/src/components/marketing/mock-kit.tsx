import type { ReactNode } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Phone,
  Scissors,
  UserX,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { StatusChip } from "@/components/dashboard/ui";
import { cn } from "@/lib/utils";

/**
 * The pieces the landing page draws the product with.
 *
 * ---------------------------------------------------------------------------
 * **Drawn with the product's own classes, not an impression of them.** Every
 * surface here is the dashboard's glass — `glass-row`, `glass-inset`,
 * `glass-dock glass-dock-float`, `cal-glass` — and every chip is the real
 * `StatusChip`. `.mock-ui` re-scales Tailwind's spacing, type and radius
 * variables to a 390px screen (see MOCK SCREENS in `globals.css`), so a card
 * written `glass-row rounded-3xl p-4` here is the agenda's card, shrunk to the
 * frame. When the dashboard's glass changes, these change with it; they cannot
 * go stale the way the screenshots they replaced did.
 *
 * **Illustrations, and announced as such.** The names and figures are samples.
 * Each screen is one `role="img"` with a Hebrew description and an
 * `aria-hidden` interior: a screen reader walking a dozen fake buttons would be
 * reading fiction, and nothing in here is focusable.
 * ---------------------------------------------------------------------------
 */

/**
 * A phone: a hairline bezel around a screen drawn at 390px and scaled to fit.
 *
 * The bezel is the one the page's screenshots wore — a theme-aware neutral,
 * one inner hairline for the screen edge, a layered shadow with a real offset
 * — so the product still stands on the page rather than in a sticker of a
 * phone. The accent is the violet swatch, so calendar glass reads as the
 * brand's own family on a page whose one colour is violet into blue.
 */
export function MockPhone({
  label,
  className,
  children,
}: {
  /** What the screen shows, in Hebrew — the only thing a screen reader gets. */
  label: string;
  /** The caller owns the width. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "relative mx-auto w-full rounded-[2.25rem] p-[5px]",
        "bg-zinc-200/80 ring-1 ring-zinc-900/8 ring-inset dark:bg-zinc-800/80 dark:ring-white/10",
        "shadow-[0_1px_2px_-1px_rgb(24_24_27/0.12),0_18px_40px_-16px_rgb(24_24_27/0.28),0_40px_80px_-32px_rgb(24_24_27/0.22)]",
        "dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.5),0_18px_40px_-16px_rgb(0_0_0/0.6)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="mock-screen relative aspect-[390/844] overflow-hidden rounded-[1.9rem] ring-1 ring-zinc-900/10 ring-inset dark:ring-white/10"
      >
        <div data-accent="violet" className="mock-ui absolute inset-0">
          {children}
        </div>
      </div>
    </div>
  );
}

const DOCK_TABS: readonly { icon: LucideIcon }[] = [
  { icon: CalendarDays },
  { icon: Scissors },
  { icon: Clock },
  { icon: Users },
];

/**
 * The floating dock, with ליבי docked beside it — the phone's navigation as it
 * is now: one connected capsule of glass, the current tab lit, and her button
 * on the same row. At 390px the current tab folds to its icon, because the row
 * with her in it needs the room; that is what the real one does too.
 */
export function MockDock({ active = 0 }: { active?: number }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2.5 px-3 pb-3">
      {/* The page fading out under the dock, as in the app. */}
      <div className="dock-fade absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+3rem)]" />
      <div className="glass-dock glass-dock-float flex h-15 items-center gap-1 rounded-full px-1.5">
        {DOCK_TABS.map(({ icon: Icon }, index) =>
          index === active ? (
            <span
              key={index}
              className="glass-bubble-active flex h-12 items-center rounded-full px-1"
            >
              <span className="glass-dock-glow flex size-10 items-center justify-center rounded-full text-white">
                <Icon className="size-5" />
              </span>
            </span>
          ) : (
            <span
              key={index}
              className="glass-bubble flex size-12 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-200"
            >
              <Icon className="size-5" />
            </span>
          ),
        )}
        <span className="glass-bubble flex size-12 items-center justify-center rounded-full text-zinc-700 dark:text-zinc-200">
          <MoreHorizontal className="size-5" />
        </span>
      </div>
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white shadow-lg">
        <Mic className="size-6" />
      </span>
    </div>
  );
}

/** ליבי's thinking orb — see `.mock-orb`. */
export function MockOrb({ className }: { className?: string }) {
  return <span className={cn("mock-orb text-violet-600 dark:text-violet-300", className)} />;
}

/** Her glow along the bottom of the screen — see `.mock-voice-glow`. */
export function MockVoiceGlow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mock-voice-glow pointer-events-none absolute inset-x-0 bottom-0 h-44",
        className,
      )}
    />
  );
}

/**
 * ליבי's card, as the app draws it above the dock: what she heard, what she
 * said, and — while she is waiting on an answer — the change on a button and
 * the reminder that a spoken "כן" does the same.
 */
export function MockLibiCard({
  heard,
  reply,
  confirm,
  status,
  className,
}: {
  heard: string;
  reply: string;
  /** The change awaiting a yes, as its button reads. */
  confirm?: string;
  /** The status row's words — the orb beside them. */
  status: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-3 bottom-22 z-20 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95",
        className,
      )}
    >
      <p className="truncate text-xs text-zinc-500">ליבי שמעה: «{heard}»</p>
      <p className="mt-1 text-sm leading-relaxed font-semibold text-zinc-900 dark:text-zinc-50">
        {reply}
      </p>
      {confirm ? (
        <div className="mt-3">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white">
            <Check className="size-3.5" />
            {confirm}
          </span>
          <p className="mock-text-11 mt-1.5 text-zinc-500 dark:text-zinc-400">
            אפשר גם פשוט לענות לה &quot;כן&quot;.
          </p>
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2">
        <MockOrb />
        <span className="libi-shimmer text-xs font-semibold">{status}</span>
      </div>
    </div>
  );
}

/** The actions a booking row carries, by what state it is in. */
type RowActions = "open" | "request" | "none";

/**
 * One row of the agenda, as `AgendaList` draws it: the time on its own glass,
 * the name and its status, the service and price, and the row's actions.
 */
export function MockAgendaRow({
  start,
  end,
  name,
  status,
  service,
  price,
  actions = "open",
}: {
  start: string;
  end: string;
  name: string;
  status: "confirmed" | "pending" | "completed";
  service: string;
  price: string;
  actions?: RowActions;
}) {
  const request = status === "pending";

  return (
    <div
      className={cn(
        "glass-row rounded-3xl p-4",
        request && "glass-row-pending",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="glass-inset shrink-0 rounded-2xl px-3 py-2 text-center">
          <p className="text-lg leading-none font-bold text-zinc-900 tabular-nums dark:text-zinc-100">
            {start}
          </p>
          <p className="mock-text-11 mt-1 text-zinc-600 tabular-nums dark:text-zinc-400">
            {end}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {name}
            </p>
            <StatusChip status={status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
            {service} · {price}
          </p>
        </div>
      </div>

      {actions === "none" ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions === "request" ? (
            <>
              <MockPill tone="approve" icon={Check}>
                אישור התור
              </MockPill>
              <MockPill tone="red" icon={X}>
                דחייה
              </MockPill>
            </>
          ) : (
            <>
              <MockPill tone="plain" icon={Phone}>
                טלפון
              </MockPill>
              <MockPill tone="whatsapp" icon={MessageCircle}>
                וואטסאפ
              </MockPill>
              <MockPill tone="brand" icon={Check}>
                הושלם
              </MockPill>
              <MockPill tone="plain" icon={UserX}>
                לא הגיע
              </MockPill>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PILL_TONE = {
  plain: "text-zinc-800 dark:text-zinc-200",
  whatsapp: "text-emerald-800 dark:text-emerald-300",
  brand: "text-violet-800 dark:text-violet-300",
  approve: "bg-emerald-600 text-white",
  red: "text-red-700 dark:text-red-300",
} as const;

/** A row action: the agenda's glass pill, or the solid approve. */
function MockPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof PILL_TONE;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
        tone === "approve" ? "shadow-sm" : "glass-control",
        PILL_TONE[tone],
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}
