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
  width,
  height,
  fallback,
  priority = false,
  className,
  /**
   * **A flat 284px, at every breakpoint.** The frame below is capped by
   * `max-w-[19rem]` (304px) minus its own 10px padding either side, so the
   * image is never wider than 284 CSS pixels however wide the viewport gets.
   *
   * It previously declared `78vw` / `45vw`, which told the browser to fetch for
   * a width the layout cannot produce — over-fetching on a phone while doing
   * nothing for sharpness. Naming the real cap lets the browser multiply it by
   * the device pixel ratio and land on the right rung of the srcset: 384 at 1×,
   * 640 at 2×, 1080 at 3×.
   */
  sizes = "284px",
}: {
  src: string;
  /**
   * What the screenshot *shows*, in Hebrew — not "screenshot of the app".
   * These are the only images on the page carrying product information, so
   * their alt text is the one a screen reader needs to convey the feature.
   */
  alt: string;
  /**
   * Intrinsic pixel size of the file, from `resolveScreenshot`. Passed rather
   * than hardcoded because the HD replacements are a different shape from the
   * 736×1600 originals, and a declared ratio that disagrees with the real one
   * distorts the image.
   */
  width: number;
  height: number;
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
            width={width}
            height={height}
            sizes={sizes}
            priority={priority}
            /**
             * 90 rather than the default 75.
             *
             * The sources arrived through WhatsApp at roughly 0.06 bytes per
             * pixel — five to eight times more compressed than a quality-90
             * JPEG — so re-encoding at 75 stacked a *second* lossy generation on
             * an already-mushy image. This does not recover detail that is not
             * in the file; it stops the pipeline removing more. The real fix is
             * a better source in `screenshots/hd/`, which `resolveScreenshot`
             * picks up automatically.
             *
             * The cost is small in absolute terms because these render at 284
             * CSS pixels, so even the 3× rung is a modest file.
             */
            quality={90}
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
