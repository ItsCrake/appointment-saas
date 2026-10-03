import { Move } from "lucide-react";

import { MockPhone } from "./mock-kit";
import { WeekScreen } from "./mock-screens";

/**
 * The product, standing on the page rather than inside a box.
 *
 * ---------------------------------------------------------------------------
 * **The ground is the page's own paper**, a hairline grid under it and one soft
 * brand glow behind the device — no gradient card doing the work a product
 * shot should do by itself. The phone is drawn, not photographed: **the full
 * week calendar** (see `WeekScreen`) — since 2026-10-03 the first picture on
 * the page, because a week full of bookings is the outcome a shop owner is
 * buying, and the owner asked for the product before the prose. It is built
 * from the dashboard's own classes so it cannot go stale the way the screenshot
 * it replaced did. The agenda with ליבי mid-sentence moved into the tour.
 *
 * **Two badges, each a half of the product, shown happening.** On the leading
 * edge, the move the calendar is in the middle of — Shira's booking carried to
 * 12:05 in edit mode, exactly the dashed ghost on the screen. On the trailing
 * edge, a booking a client made by themselves through the link. A third would
 * turn the composition back into decoration.
 *
 * Positioned against the phone's own box so they keep their relationship to
 * the device at every width, and `aria-hidden`: the phone's description
 * already says what is on it, and a screen reader meeting "new booking" out of
 * context learns nothing true.
 * ---------------------------------------------------------------------------
 */
export function MockupShowcase() {
  return (
    <div className="relative mx-auto w-full max-w-[22rem]">
      {/* The glow, behind everything and larger than the phone, so the device
          edge never lands on the gradient's own edge. */}
      <div
        aria-hidden
        className="hero-glow pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10"
      />

      <MockPhone label="היומן השבועי המלא בטלפון, במצב עריכה: תורים כמעט בכל יום, בקשה אחת בכתום, ותור של שירה שנגרר לשעה חדשה עם מסגרת מקווקוות במקום שבו ינחת">
        <WeekScreen />
      </MockPhone>

      {/* The move in progress. Leading edge, high — the same booking the
          dashed ghost on the screen is carrying. */}
      <div
        aria-hidden
        className="hero-badge absolute -start-4 top-[18%] flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:-start-10"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[image:var(--brand-gradient)] text-white">
          <Move className="size-3.5" strokeWidth={2.25} />
        </span>
        <span className="text-start">
          <span className="block text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
            גוררים באצבע
          </span>
          <span className="block text-[12px] leading-tight font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
            שירה עוברת ל־12:05
          </span>
        </span>
      </div>

      {/* A booking a client made alone. Trailing edge, lower, so the two
          badges read as the day going on around the conversation. */}
      <div
        aria-hidden
        className="hero-badge absolute -end-4 top-[46%] flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:-end-10"
      >
        <span className="relative flex size-2.5 shrink-0 text-emerald-500">
          <span className="hero-ping absolute inset-0 rounded-full" />
          <span className="relative size-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-start">
          <span className="block text-[11px] leading-tight font-semibold text-zinc-900 dark:text-zinc-100">
            נקבע תור חדש מהקישור
          </span>
          <span className="block text-[10px] leading-tight text-zinc-500 tabular-nums dark:text-zinc-400">
            17:30 · תספורת גבר
          </span>
        </span>
      </div>
    </div>
  );
}
