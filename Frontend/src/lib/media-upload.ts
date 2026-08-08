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
 * 5MB. Enforced in three places on purpose, each covering the last one's gap:
 * here for instant feedback, in the action before a ticket is issued, and on
 * the bucket itself — which is the only one a crafted request cannot skip.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Images only. `image/svg+xml` is deliberately absent: an SVG is a document
 * that can carry script, and these files are served from a public bucket on a
 * Supabase origin — harmless for `<img>`, not harmless for anyone who opens the
 * URL directly.
 */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** For the file input's `accept`, which is a hint to the picker, not a check. */
export const UPLOAD_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * Extension per MIME type — **never taken from the uploaded filename**. A name
 * is attacker-controlled and is the classic way a path picks up a `..` or a
 * second extension; the type has already been checked against the list above.
 */
const EXTENSIONS: Record<AcceptedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/** What the image is for. Decides the folder, and which gate applies. */
export const MEDIA_KINDS = ["logo", "hero", "gallery", "staff"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

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
 */
export function describeUploadProblem(file: {
  type: string;
  size: number;
}): string | null {
  if (!isAcceptedImageType(file.type)) {
    // Named rather than listed: an owner who picked a PDF needs to know their
    // file is the wrong kind, not to read five MIME types.
    return "אפשר להעלות תמונות בלבד (JPG, PNG, WEBP, AVIF או GIF).";
  }

  // An empty file is not a size problem, and "0MB מתוך 5" reads as nonsense.
  if (file.size <= 0) {
    return "הקובץ ריק.";
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `הקובץ גדול מדי (${toMb(file.size)}MB). המקסימום הוא ${toMb(MAX_UPLOAD_BYTES)}MB.`;
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
  contentType: AcceptedImageType;
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
