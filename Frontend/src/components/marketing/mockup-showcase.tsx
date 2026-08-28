import { Check, MessageCircle } from "lucide-react";

import { resolveScreenshot } from "@/lib/screenshots";

import { DashboardMockup } from "./dashboard-mockup";
import { PhoneFrame } from "./phone-frame";

/**
 * The product, standing on the page rather than inside a box.
 *
 * ---------------------------------------------------------------------------
 * **What this replaced, and why.** The phone used to sit inside a
 * violet→blue gradient card with a dot texture and three frosted squares
 * floating above it. That card was doing the work a product shot should do by
 * itself: it supplied the colour, the depth and the interest, and the screen it
 * contained was incidental. It also forced everything near it to be white,
 * which is how the wordmark ended up hardcoding `text-white`.
 *
 * Now the ground is the page's own paper with a hairline grid, one soft brand
 * glow sits behind the device, and the only things floating are two badges
 * that **carry real content**. The floor is explicit that soft-shadowed
 * rounded rectangles standing in for content are a costume — so the frosted
 * squares are gone, and what replaced them says what the product actually did:
 * a booking arrived, and a WhatsApp message went out.
 *
 * **Two badges, not five.** Each one is a claim the page makes elsewhere in
 * words, shown happening. A third would turn the composition back into
 * decoration, which is what was wrong with it before.
 *
 * The badges are positioned against the phone's own box rather than the
 * section, so they keep their relationship to the device at every width, and
 * they are `aria-hidden`: the screenshot's `alt` already describes the screen,
 * and a screen reader meeting "new booking, 14:30" out of context learns
 * nothing true.
 * ---------------------------------------------------------------------------
 */
export function MockupShowcase() {
  const hero = resolveScreenshot("agenda-today");

  return (
    <div className="relative mx-auto w-full max-w-[22rem]">
      {/* The glow, behind everything and larger than the phone, so the device
          edge never lands on the gradient's own edge. */}
      <div
        aria-hidden
        className="hero-glow pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10"
      />

      <PhoneFrame
        src={hero.src}
        width={hero.width}
        height={hero.height}
        alt="מסך היומן של בעל עסק: תורי היום עם הסכום הצפוי, בקשה אחת שממתינה לאישור, וכפתורי אישור וביטול לכל תור"
        // The drawn agenda, if the file is ever missing — the same component
        // that carried this page before the screenshots existed.
        fallback={<DashboardMockup className="relative" />}
        priority
        // 22rem cap minus the frame's 5px bezel either side.
        sizes="342px"
      />

      {/* A booking that just arrived. Sits on the leading edge, clear of the
          phone's own status bar and its bottom tab row. */}
      <div
        aria-hidden
        className="hero-badge absolute -start-4 top-[22%] flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:-start-8"
      >
        <span className="relative flex size-2.5 shrink-0 text-emerald-500">
          <span className="hero-ping absolute inset-0 rounded-full" />
          <span className="relative size-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-start">
          <span className="block text-[11px] leading-tight font-semibold text-zinc-900 dark:text-zinc-100">
            נקבע תור חדש
          </span>
          <span className="block text-[10px] leading-tight text-zinc-500 tabular-nums dark:text-zinc-400">
            14:30 · תספורת גבר
          </span>
        </span>
      </div>

      {/* The message that went out because of it. Trailing edge, lower, so the
          two badges read as a sequence down the device rather than as a pair
          of stickers at the same height. */}
      <div
        aria-hidden
        className="hero-badge absolute -end-4 bottom-[18%] flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:-end-8"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <MessageCircle className="size-3.5" strokeWidth={2} />
        </span>
        <span className="text-start">
          <span className="block text-[11px] leading-tight font-semibold text-zinc-900 dark:text-zinc-100">
            נשלח בוואטסאפ
          </span>
          <span className="flex items-center gap-1 text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
            <Check className="size-2.5 shrink-0" strokeWidth={3} />
            אישור התור נמסר
          </span>
        </span>
      </div>
    </div>
  );
}
