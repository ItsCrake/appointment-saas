/**
 * Owner-uploaded images: what is allowed, where it lands, and what URL it gets.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER UPLOADS DIRECTLY, AND WHY IT NEEDS A TICKET TO DO IT
 *
 * The bytes never pass through the Next server. Two independent reasons:
 *
 * 1. A Server Action body is capped at 1MB by default, and raising the cap only
 *    moves the problem — a 5MB photo would still be buffered in a serverless
 *    function's memory on its way to storage, paid for twice and slow on the
 *    phone connection this product is actually used on.
 * 2. Supabase Storage already speaks HTTP. Proxying it would add a hop that can
 *    only ever fail more often than the direct one.
 *
 * But the browser has **no Supabase session to authenticate with**: the auth
 * cookies are `httpOnly` (see `supabase/cookies.ts` — deliberately, so an XSS
 * bug cannot walk away with the token), so a browser client would upload as
 * anonymous and any RLS policy would refuse it.
 *
 * So the server issues a **ticket**: a signed upload URL good for one exact
 * path. The authorisation decision therefore happens in `requireWritable()`,
 * the same place as every other dashboard mutation and the one the coverage
 * test already polices — rather than in a storage RLS policy that would be a
 * second, drifting copy of "who owns this business". That also keeps admin
 * impersonation working, which a policy keyed on `auth.uid()` would silently
 * break.
 *
 * This module is the pure half of that: no IO, no Supabase, so every rule below
 * is directly testable.
 * ---------------------------------------------------------------------------
 */

/** Public bucket. Created by `npm run storage:setup`, not by a migration. */
export const MEDIA_BUCKET = "business-media";

/**
 * 5MB for a picture.
 *
 * Enforced in three places on purpose, each covering the last one's gap: here
 * for instant feedback, in the action before a ticket is issued, and on the
 * bucket — see the honest note on `MAX_VIDEO_BYTES` about what the bucket can
 * and cannot police once two limits exist.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * 25MB for a hero video, and the number is a product decision rather than a
 * technical ceiling.
 *
 * This file autoplays on a client's **first paint**, usually on mobile data, in
 * a country where that costs money. 25MB of H.264 is roughly 20 seconds of
 * decent 1080p — enough for the loop a shop actually wants, and little enough
 * that a page still arrives. Raising it trades a booking page that loads for
 * one that buffers.
 *
 * A bucket carries **one** `file_size_limit`, so it is set to this, the larger
 * of the two. The 5MB image rule is therefore enforced by the browser and by
 * `requestMediaUploadAction` only — a crafted request could put a 20MB PNG in a
 * tenant's own folder. That costs storage, not safety, and the alternative is a
 * second bucket to police a number the app already checks twice.
 */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/**
 * Images. `image/svg+xml` is deliberately absent: an SVG is a document that can
 * carry script, and these files are served from a public bucket on a Supabase
 * origin — harmless for `<img>`, not harmless for anyone who opens the URL
 * directly.
 */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

/**
 * Video, for the hero banner only.
 *
 * Two containers, because between them every browser this product runs on can
 * play something: MP4/H.264 is universal, WebM is what a shop's own editor is
 * most likely to export. No HLS and no adaptive anything — this is a decorative
 * loop behind a heading, not a player.
 */
export const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];
export type AcceptedVideoType = (typeof ACCEPTED_VIDEO_TYPES)[number];
export type AcceptedMediaType = AcceptedImageType | AcceptedVideoType;

/** Everything the bucket will hold, for `storage:setup`. */
export const ACCEPTED_MEDIA_TYPES = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_VIDEO_TYPES,
] as const;

/**
 * Extension per MIME type — **never taken from the uploaded filename**. A name
 * is attacker-controlled and is the classic way a path picks up a `..` or a
 * second extension; the type has already been checked against the list above.
 */
const EXTENSIONS: Record<AcceptedMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** What the media is for. Decides the folder, and which rules apply. */
export const MEDIA_KINDS = [
  "logo",
  "hero",
  "gallery",
  "staff",
  // A picture of what the shop sells (0027). Follows `staff` rather than
  // `gallery`: it is content on the booking page, not branding decoration, so
  // it is not behind the Pro gate below.
  "service",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * **Only the hero takes video.** A looping clip behind the business name is a
 * banner; a looping clip as a logo, a gallery thumbnail or someone's portrait
 * is a mistake nobody meant to make, and the places those render are `<img>`
 * tags that would show nothing at all.
 */
export const VIDEO_KINDS: readonly MediaKind[] = ["hero"];

export function acceptsVideo(kind: MediaKind): boolean {
  return VIDEO_KINDS.includes(kind);
}

/** The types a given surface will actually take. */
export function acceptedTypesFor(
  kind: MediaKind,
): readonly AcceptedMediaType[] {
  return acceptsVideo(kind) ? ACCEPTED_MEDIA_TYPES : ACCEPTED_IMAGE_TYPES;
}

/** The size ceiling for a given content type. */
export function maxBytesFor(contentType: string): number {
  return isAcceptedVideoType(contentType) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
}

/** `"image"` or `"video"`, matching `businesses.hero_media_type`. */
export function mediaTypeOf(contentType: string): "image" | "video" | null {
  if (isAcceptedVideoType(contentType)) return "video";
  if (isAcceptedImageType(contentType)) return "image";
  return null;
}

/**
 * Kinds that live behind the Pro branding gate, mirroring where the *save* is
 * gated in `saveAppearanceAction`. Uploading bytes a tenant is not allowed to
 * display would burn their storage quota for nothing.
 *
 * The logo is not here: it predates the gate, renders for every tenant on the
 * public page today, and is not in the upsell's list of what Pro buys.
 */
export const BRANDED_KINDS: readonly MediaKind[] = ["hero", "gallery"];

export function isMediaKind(value: unknown): value is MediaKind {
  return (
    typeof value === "string" &&
    (MEDIA_KINDS as readonly string[]).includes(value)
  );
}

export function isAcceptedImageType(
  value: unknown,
): value is AcceptedImageType {
  return (
    typeof value === "string" &&
    (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value)
  );
}

export function isAcceptedVideoType(
  value: unknown,
): value is AcceptedVideoType {
  return (
    typeof value === "string" &&
    (ACCEPTED_VIDEO_TYPES as readonly string[]).includes(value)
  );
}

/** For the file input's `accept`, which is a hint to the picker, not a check. */
export function uploadAccept(kind: MediaKind): string {
  return acceptedTypesFor(kind).join(",");
}

/** Megabytes, for a message. `5` rather than `5.0`. */
function toMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

/**
 * The single reason a file cannot be uploaded, in Hebrew, or null if it can.
 *
 * One function so the browser and the action cannot disagree about what is
 * allowed — the browser's copy is only there to fail in a tenth of a second
 * instead of after a round trip.
 *
 * Takes the `kind`, because the answer genuinely depends on it: the hero takes
 * video at 25MB, everywhere else takes images at 5MB. A single global rule
 * would either refuse the banner a shop wants or let a 25MB clip become
 * somebody's profile picture.
 */
export function describeUploadProblem(
  file: { type: string; size: number },
  kind: MediaKind = "gallery",
): string | null {
  const video = isAcceptedVideoType(file.type);
  const allowed = acceptsVideo(kind)
    ? video || isAcceptedImageType(file.type)
    : isAcceptedImageType(file.type);

  if (!allowed) {
    // Named rather than listed: an owner who picked a PDF needs to know their
    // file is the wrong kind, not to read seven MIME types. A video refused on
    // a logo says so specifically, because "images only" would read as a bug to
    // someone who just uploaded one to the banner.
    if (video) return "אפשר להעלות סרטון בבאנר העליון בלבד.";
    return "אפשר להעלות תמונות בלבד (JPG, PNG, WEBP, AVIF או GIF).";
  }

  // An empty file is not a size problem, and "0MB מתוך 5" reads as nonsense.
  if (file.size <= 0) {
    return "הקובץ ריק.";
  }

  const limit = maxBytesFor(file.type);
  if (file.size > limit) {
    return `הקובץ גדול מדי (${toMb(file.size)}MB). המקסימום הוא ${toMb(limit)}MB.`;
  }

  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `{businessId}/{kind}/{unique}.{ext}`.
 *
 * The tenant id is the first segment so that everything a business owns shares
 * a prefix: a future cleanup, a quota report or an RLS policy can all key on it
 * without a lookup, and one tenant's files can never be interleaved with
 * another's.
 *
 * Both variable parts are checked to be UUIDs rather than escaped. Escaping
 * invites the question of whether it was done right; a UUID has no separator,
 * no dot and no case where the answer is subtle.
 */
export function buildMediaPath(input: {
  businessId: string;
  kind: MediaKind;
  contentType: AcceptedMediaType;
  /** Server-generated. Passed in so this function stays pure. */
  unique: string;
}): string {
  if (!UUID_PATTERN.test(input.businessId)) {
    throw new Error("buildMediaPath: businessId must be a UUID");
  }
  if (!UUID_PATTERN.test(input.unique)) {
    throw new Error("buildMediaPath: unique must be a UUID");
  }
  if (!isMediaKind(input.kind)) {
    throw new Error("buildMediaPath: unknown media kind");
  }

  // A fresh name every time rather than `logo.png`, so replacing an image can
  // never be defeated by a CDN cache holding the old bytes at the same URL.
  return `${input.businessId}/${input.kind}/${input.unique}.${EXTENSIONS[input.contentType]}`;
}

/**
 * The URL the object will be readable at once uploaded.
 *
 * Built rather than requested: the shape is fixed by Supabase for public
 * buckets, and asking for it would mean a second round trip to learn something
 * already known. `getPublicUrl` in the SDK does exactly this string join.
 */
export function publicMediaUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}
