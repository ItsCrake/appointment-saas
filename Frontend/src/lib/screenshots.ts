import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where the landing page's product screenshots come from, and how a better one
 * replaces a worse one without touching a component.
 *
 * ---------------------------------------------------------------------------
 * **The originals arrived through WhatsApp**, which downscales and recompresses
 * hard: 736×1600 at roughly 0.06 bytes per pixel, where a quality-90 JPEG runs
 * five to eight times that. On a 3× phone the frame also needs 852px against a
 * 736px source, so there is a 16% upscale on top. The compression is the larger
 * of the two problems and no encoder setting can undo it — the detail is not in
 * the file.
 *
 * So this resolves each slot against `public/screenshots/hd/` **first** and
 * falls back to the original. Dropping a proper capture in that folder is the
 * entire upgrade: no import changes, no rebuild of the components, and no
 * window where the page renders a broken image because a file has not arrived
 * yet.
 *
 * **Dimensions are read from the file rather than declared**, because a
 * hardcoded `width`/`height` that disagrees with the real image distorts it —
 * and the whole point of the HD folder is that the replacement may be a
 * different size. iPhone captures are 1179×2556 or 1290×2796 depending on the
 * model, and neither matches the 736×1600 this page started with.
 *
 * Server-only: it touches the filesystem, so every caller is a server
 * component that passes the resolved values down to `PhoneFrame`.
 * ---------------------------------------------------------------------------
 */

const PUBLIC = path.resolve(process.cwd(), "public");
const BASE_DIR = "screenshots";
const HD_DIR = "screenshots/hd";

/** The eight captures the landing page can draw on, by slot name. */
export const SCREENSHOT_SLOTS = [
  "agenda-today",
  "agenda-stats",
  "week-calendar",
  "week-calendar-pending",
  "approval-request",
  "appointment-sheet",
  "clients",
  "analytics",
] as const;

export type ScreenshotSlot = (typeof SCREENSHOT_SLOTS)[number];

export type ResolvedScreenshot = {
  /** Public path, ready for `next/image`. */
  src: string;
  width: number;
  height: number;
  /** True when the HD folder supplied it — useful for a build-time report. */
  hd: boolean;
};

/**
 * Preferred first. PNG leads because it is what a phone produces natively and
 * carries no second lossy generation; `next/image` re-encodes to AVIF/WebP for
 * delivery either way, so a lossless source is strictly better input.
 */
const HD_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;

/** Intrinsic size, straight from the file header. */
function dimensionsOf(absolute: string): { width: number; height: number } {
  const buffer = readFileSync(absolute);

  // PNG: IHDR is always the first chunk, width and height at fixed offsets.
  if (buffer.length > 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // WebP (VP8X / VP8L / VP8 ) — only the lossy and extended forms are read
  // here, which is what an export tool produces.
  if (buffer.length > 30 && buffer.toString("ascii", 8, 12) === "WEBP") {
    const format = buffer.toString("ascii", 12, 16);
    if (format === "VP8X") {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (format === "VP8 ") {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
  }

  // JPEG: walk the segment chain to the start-of-frame marker.
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buffer[i + 1];
    const isFrameStart =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isFrameStart) {
      return {
        height: buffer.readUInt16BE(i + 5),
        width: buffer.readUInt16BE(i + 7),
      };
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }

  throw new Error(`screenshots: could not read dimensions from ${absolute}`);
}

/**
 * The best available file for a slot.
 *
 * Throws when neither an HD nor a base file exists, which is deliberate: a
 * missing slot is a build-time mistake, and `PhoneFrame`'s runtime fallback is
 * for a file that vanishes *after* a successful build rather than for one that
 * was never there.
 */
export function resolveScreenshot(slot: ScreenshotSlot): ResolvedScreenshot {
  for (const extension of HD_EXTENSIONS) {
    const relative = `${HD_DIR}/${slot}.${extension}`;
    const absolute = path.join(PUBLIC, relative);
    if (existsSync(absolute)) {
      return { src: `/${relative}`, ...dimensionsOf(absolute), hd: true };
    }
  }

  const relative = `${BASE_DIR}/${slot}.jpg`;
  const absolute = path.join(PUBLIC, relative);
  if (!existsSync(absolute)) {
    throw new Error(`screenshots: no file for slot "${slot}"`);
  }

  return { src: `/${relative}`, ...dimensionsOf(absolute), hd: false };
}
