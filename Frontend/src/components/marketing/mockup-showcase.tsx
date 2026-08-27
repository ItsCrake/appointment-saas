import type { CSSProperties } from "react";
import { BellRing, CalendarCheck, Clock3 } from "lucide-react";

import { resolveScreenshot } from "@/lib/screenshots";

import { DashboardMockup } from "./dashboard-mockup";
import { PhoneFrame } from "./phone-frame";

/**
 * The agenda preview, presented inside a brand-gradient card.
 *
 * The glass tiles sit in a band *above* the mockup rather than scattered over
 * it. Floating them across the card looked richer in the abstract and covered
 * live rows in practice: a status badge half-hidden behind a frosted square is
 * worse than no decoration at all. The band gives them somewhere to float that
 * is genuinely empty.
 *
 * Everything decorative here is `aria-hidden`. The mockup below carries the
 * single `role="img"` description for the whole composition.
 */

const TILES = [
  { icon: Clock3, tilt: "-8deg", duration: "7.5s", delay: "0s" },
  { icon: CalendarCheck, tilt: "6deg", duration: "8.4s", delay: "-1.6s" },
  { icon: BellRing, tilt: "-5deg", duration: "9.1s", delay: "-3.2s" },
] as const;

export function MockupShowcase() {
  const hero = resolveScreenshot("agenda-today");

  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-purple-900 via-indigo-800 to-blue-700 p-3 pt-0 shadow-[0_24px_60px_-24px_rgb(49_46_129/0.55)]">
      {/* Dot matrix, faded downward so it never fights the white mockup edge. */}
      <div
        aria-hidden
        className="dot-matrix pointer-events-none absolute inset-0 rounded-3xl [mask-image:linear-gradient(to_bottom,#000_15%,transparent_75%)]"
      />

      {/* The band the tiles float in. */}
      <div
        aria-hidden
        className="relative flex items-center justify-center gap-3 py-3"
      >
        {TILES.map(({ icon: Icon, tilt, duration, delay }, i) => (
          <span
            key={i}
            style={
              {
                "--tilt": tilt,
                "--float-duration": duration,
                "--float-delay": delay,
              } as CSSProperties
            }
            className="animate-tile inline-flex size-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] backdrop-blur-md"
          >
            <Icon className="size-4 text-white/85" strokeWidth={1.5} />
          </span>
        ))}
      </div>

      {/**
       * The real agenda, in a phone, with the drawn one underneath it.
       *
       * This card used to render `DashboardMockup` directly — a CSS agenda that
       * looked right and proved nothing. The screenshot is the same screen with
       * real bookings, real prices and a real Hebrew client list, which is the
       * one asset on this page a competitor cannot draw.
       *
       * `priority` because it is the largest element in the first viewport and
       * is the page's LCP candidate; every other screenshot on the page loads
       * lazily. The drawn mockup stays as the fallback, so a missing file
       * degrades to what shipped before rather than to a grey rectangle.
       */}
      <PhoneFrame
        src={hero.src}
        width={hero.width}
        height={hero.height}
        alt="מסך היומן של בעל עסק: ארבעה תורים היום, סכום צפוי, וכפתורי אישור וביטול לכל תור"
        fallback={<DashboardMockup className="relative" />}
        priority
        className="relative"
      />
    </div>
  );
}
