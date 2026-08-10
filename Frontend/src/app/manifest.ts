import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/brand";

/**
 * The web app manifest, which is what makes "Add to Home Screen" offer a real
 * install rather than a bookmark.
 *
 * ---------------------------------------------------------------------------
 * `start_url` is **the dashboard, not `/`**. Whoever installs this is an owner:
 * a client books once from a link and never installs anything. Landing them on
 * the marketing page every time they tap their own icon would be the app
 * opening on an advert for itself.
 *
 * `display: standalone` rather than `fullscreen` — the owner needs the status
 * bar, because the single most common use is checking the time of the next
 * appointment against the clock.
 *
 * Two icon entries per size, `any` and `maskable`, because Android crops to
 * whatever shape the launcher uses. A single `any` icon gets its corners cut
 * off; a single `maskable` one is drawn with its safe padding visible and
 * floats small inside the tile.
 * ---------------------------------------------------------------------------
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.nameHe} — ניהול תורים`,
    short_name: BRAND.nameHe,
    description: BRAND.tagline,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches the dashboard's own paper, so the splash screen does not flash a
    // colour the app never uses.
    background_color: "#ffffff",
    // The brand ramp's mid stop, which is what the status bar tints to.
    theme_color: "#4f46e5",
    lang: "he",
    dir: "rtl",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
