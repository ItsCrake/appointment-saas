import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where the landing page's product screenshots come from.
 *
 * ---------------------------------------------------------------------------
 * Components name a **slot** rather than a path, and this resolves it to a file
 * plus that file's real pixel dimensions. Two things fall out of that, and
 * both are why it survived the removal of the HD experiment:
 *
 * - A slot with no file **throws at build time**, naming the slot. A literal
 *   `src` that has drifted from the filesystem fails silently and renders a
 *   broken image on the page whose job is convincing a shop owner the product
 *   is real. `PhoneFrame`'s runtime fallback is the net; this is what stops it
 *   being needed.
 * - Dimensions are **read from the file** rather than declared. A hardcoded
 *   `width`/`height` that disagrees with the image distorts it, and the sizes
 *   here are not something a component should be asserting from memory.
 *
 * Server-only: it touches the filesystem, so callers are server components
 * that pass the resolved values down.
 * ---------------------------------------------------------------------------
 */

const PUBLIC = path.resolve(process.cwd(), "public");
const BASE_DIR = "screenshots";

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
};

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
 * The file for a slot.
 *
 * Throws when it is absent, which is deliberate: a missing slot is a
 * build-time mistake and should stop the build rather than reach a visitor.
 */
export function resolveScreenshot(slot: ScreenshotSlot): ResolvedScreenshot {
  const relative = `${BASE_DIR}/${slot}.jpg`;
  const absolute = path.join(PUBLIC, relative);

  if (!existsSync(absolute)) {
    throw new Error(`screenshots: no file for slot "${slot}"`);
  }

  return { src: `/${relative}`, ...dimensionsOf(absolute) };
}
