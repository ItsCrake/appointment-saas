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
  preload = false,
  className,
  /**
   * **The width the image actually renders at, as a flat value.**
   *
   * Callers cap their own width now, so each one states its real number rather
   * than inheriting a guess. Declaring `78vw`/`45vw` — as this did — tells the
   * browser to fetch for a width the layout cannot produce: over-fetching on a
   * phone while doing nothing for sharpness. A flat cap lets it multiply by the
   * device pixel ratio and land on the right rung of the srcset.
   */
  sizes,
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
  /**
   * **`preload`, not `priority` — the prop this used to take is deprecated.**
   *
   * Next 16 deprecated `priority` in favour of `preload`, and a deprecated prop
   * is not a working one: the hero passed `priority` and the rendered `<img>`
   * came out with `loading="auto"` and no `fetchpriority` at all, which is the
   * same treatment every other image on the page got. Named after the framework
   * rather than after the intent, so the next rename is a type error instead of
   * a silent no-op.
   *
   * True on the hero only. It inserts a `<link rel="preload">` in the head, and
   * the docs are explicit that more than one candidate for the LCP element is a
   * reason *not* to use it.
   */
  preload?: boolean;
  /** Controls the frame's width; the caller owns the cap. */
  className?: string;
  sizes: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={cn(
        "relative mx-auto w-full",
        /**
         * A hairline bezel, not a slab.
         *
         * This was a 10px black surround with a heavy double shadow, which is
         * the shape a device *photograph* has — and next to a flat page it read
         * as a sticker of a phone rather than as the product. 5px of a
         * theme-aware neutral, one inner hairline for the screen edge, and a
         * layered shadow with a real offset does the same job and gets out of
         * the way.
         *
         * The outer radius still exceeds the inner by roughly the bezel width;
         * matching them makes the two curves look concentric and wrong.
         */
        "rounded-[2.25rem] p-[5px]",
        "bg-zinc-200/80 dark:bg-zinc-800/80",
        "ring-1 ring-zinc-900/8 ring-inset dark:ring-white/10",
        "shadow-[0_1px_2px_-1px_rgb(24_24_27/0.12),0_18px_40px_-16px_rgb(24_24_27/0.28),0_40px_80px_-32px_rgb(24_24_27/0.22)]",
        "dark:shadow-[0_1px_2px_-1px_rgb(0_0_0/0.5),0_18px_40px_-16px_rgb(0_0_0/0.6)]",
        className,
      )}
    >
      <div className="relative overflow-hidden rounded-[1.9rem] bg-white ring-1 ring-zinc-900/10 ring-inset dark:bg-zinc-950 dark:ring-white/10">
        {failed && fallback ? (
          fallback
        ) : (
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            sizes={sizes}
            preload={preload}
            /**
             * 90 rather than the default 75.
             *
             * The sources arrived through WhatsApp at roughly 0.06 bytes per
             * pixel — five to eight times more compressed than a quality-90
             * JPEG — so re-encoding at 75 stacked a *second* lossy generation on
             * an already-mushy image. This does not recover detail that is not
             * in the file; it stops the pipeline removing more. The only real
             * fix is a less-compressed source file.
             *
             * The cost is small in absolute terms because these render at 284
             * CSS pixels, so even the 3× rung is a modest file.
             */
            quality={90}
            /**
             * Below the fold everywhere except the hero, so the rest genuinely
             * should wait. The preloaded one is left with no `loading` at all
             * rather than an explicit `eager`: the docs list a `loading`
             * property as a reason not to use `preload`, and the default for an
             * `<img>` without one is already eager.
             */
            loading={preload ? undefined : "lazy"}
            onError={() => setFailed(true)}
            className="block h-auto w-full"
          />
        )}
      </div>
    </div>
  );
}
