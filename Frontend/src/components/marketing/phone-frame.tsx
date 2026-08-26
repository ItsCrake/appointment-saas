"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A real screenshot inside a phone, with the drawn mockup underneath it.
 *
 * ---------------------------------------------------------------------------
 * **The fallback is the reason this is a client component.** `next/image` only
 * reports a failure through `onError`, which needs state — and a marketing page
 * that renders an empty grey rectangle when a file is missing is worse than one
 * that never tried. So a failed load swaps in the CSS-drawn mockup that carried
 * this page before the screenshots existed: still on-brand, still animated,
 * still says what the product does.
 *
 * That path is not theoretical. These files are 736×1600 JPEGs sitting in
 * `public/`, and the two ways they go missing — a deploy that skips the folder,
 * or a rename — are both silent.
 *
 * **The frame is drawn, not photographed.** A PNG of an iPhone would be another
 * 200KB, would carry a manufacturer's industrial design onto a page selling
 * something else, and would be fixed at one resolution. Three nested elements
 * and a border-radius scale with the layout and cost nothing.
 *
 * **The screenshots are Hebrew UI at 736px wide.** Below about 240px of render
 * width the row text stops being legible and the image becomes decoration
 * pretending to be evidence, which is why the callers size these generously and
 * show at most three at once rather than a wall of nine.
 * ---------------------------------------------------------------------------
 */
export function PhoneFrame({
  src,
  alt,
  fallback,
  priority = false,
  className,
  sizes = "(min-width: 1024px) 320px, (min-width: 640px) 45vw, 78vw",
}: {
  src: string;
  /**
   * What the screenshot *shows*, in Hebrew — not "screenshot of the app".
   * These are the only images on the page carrying product information, so
   * their alt text is the one a screen reader needs to convey the feature.
   */
  alt: string;
  /** The drawn mockup, rendered instead if the file cannot be loaded. */
  fallback?: ReactNode;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[19rem]",
        // The bezel. `rounded-[2.5rem]` against the screen's `rounded-[2rem]`
        // is what reads as a phone rather than as a rounded rectangle: the
        // outer curve has to be larger than the inner by roughly the bezel
        // width or the two look concentric and wrong.
        "rounded-[2.5rem] bg-zinc-900 p-2.5",
        "shadow-[0_2px_8px_-2px_rgb(24_24_27/0.28),0_32px_64px_-24px_rgb(24_24_27/0.45)]",
        "ring-1 ring-white/10 ring-inset",
        className,
      )}
    >
      {/* The speaker slot. Small, centred, and the one detail that makes the
          frame read as a device at a glance. */}
      <span
        aria-hidden
        className="absolute top-[0.9rem] left-1/2 z-10 h-1 w-14 -translate-x-1/2 rounded-full bg-zinc-700/90"
      />

      <div className="relative overflow-hidden rounded-[2rem] bg-white dark:bg-zinc-950">
        {failed && fallback ? (
          fallback
        ) : (
          <Image
            src={src}
            alt={alt}
            width={736}
            height={1600}
            sizes={sizes}
            priority={priority}
            // Below the fold everywhere except the hero, and the hero passes
            // `priority` — so the rest genuinely should wait.
            loading={priority ? undefined : "lazy"}
            onError={() => setFailed(true)}
            className="block h-auto w-full"
          />
        )}
      </div>
    </div>
  );
}
