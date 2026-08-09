"use server";

import { z } from "zod";

import { requireWritable } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import {
  ACCEPTED_MEDIA_TYPES,
  BRANDED_KINDS,
  buildMediaPath,
  describeUploadProblem,
  isMediaKind,
  MAX_VIDEO_BYTES,
  MEDIA_BUCKET,
  MEDIA_KINDS,
  mediaTypeOf,
  publicMediaUrl,
  type MediaKind,
} from "@/lib/media-upload";
import { reportError, reportWarning } from "@/lib/observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * A permit to upload one file, to one path, once.
 *
 * `publicUrl` is handed back with it so the browser knows the final address
 * before the bytes have finished moving — the caller stores that string, and
 * whether it stores it at all is a separate decision the owner makes by
 * pressing Save.
 */
export type UploadTicket =
  | {
      ok: true;
      uploadUrl: string;
      path: string;
      publicUrl: string;
      /**
       * `"image"` or `"video"`, resolved from the content type the server
       * accepted. The hero stores the two together under a CHECK constraint, so
       * the form must not have to guess which it just uploaded.
       */
      mediaType: "image" | "video";
      /** Public key, sent as `apikey` on the upload request. */
      apiKey: string;
    }
  | { ok: false; error: string };

const requestSchema = z.object({
  kind: z.enum(MEDIA_KINDS),
  contentType: z.enum(ACCEPTED_MEDIA_TYPES),
  /**
   * Declared, not proven. Bounded by the larger of the two limits here and
   * narrowed per kind by `describeUploadProblem` below, which is the check that
   * knows a 25MB file is only legal as a hero video.
   */
  size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
});

/**
 * Issues a signed upload URL after checking the caller may write to this
 * tenant. The bytes then go from the browser straight to Supabase Storage.
 *
 * The size and type here are what the browser *claims*; a crafted request could
 * lie about both. That is why the bucket carries `file_size_limit` and
 * `allowed_mime_types` of its own — those are the guarantees, and this is the
 * error message. See `npm run storage:setup`.
 */
export async function requestMediaUploadAction(
  input: unknown,
): Promise<UploadTicket> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    // The schema's own messages are English and mention field paths, which is
    // no use to an owner. Every rejection here is one of the two rules stated
    // in `describeUploadProblem`, so say it the way the browser already did.
    const raw = input as {
      type?: unknown;
      contentType?: unknown;
      size?: unknown;
      kind?: unknown;
    } | null;
    const type =
      typeof raw?.contentType === "string"
        ? raw.contentType
        : typeof raw?.type === "string"
          ? raw.type
          : "";
    return {
      ok: false,
      error:
        describeUploadProblem(
          { type, size: typeof raw?.size === "number" ? raw.size : 0 },
          isMediaKind(raw?.kind) ? raw.kind : undefined,
        ) ?? "בקשה לא תקינה",
    };
  }

  const { kind, contentType, size } = parsed.data;

  // Per-kind, so a 25MB video is legal on the hero and refused everywhere else.
  const problem = describeUploadProblem({ type: contentType, size }, kind);
  if (problem) return { ok: false, error: problem };

  const { business } = await requireWritable();

  // Same gate as saving the value would hit. Refusing here rather than after
  // the upload means a free tenant does not spend their connection on bytes
  // that `saveAppearanceAction` would then decline to store.
  if (BRANDED_KINDS.includes(kind as MediaKind)) {
    if (!entitlementsFor(business).customBranding) {
      reportWarning("media.upload", "branding upload refused", {
        businessId: business.id,
        kind,
        planType: business.planType,
      });
      return { ok: false, error: "עיצוב מותאם זמין במסלול המקצועי" };
    }
  }

  const supabase = createSupabaseAdminClient();
  const config = getSupabaseConfig();

  if (!supabase || !config) {
    reportWarning("media.upload", "storage not configured", {
      businessId: business.id,
    });
    return {
      ok: false,
      error:
        "העלאת קבצים לא מוגדרת עדיין בשרת. אפשר להזין כתובת תמונה ידנית בינתיים.",
    };
  }

  const path = buildMediaPath({
    businessId: business.id,
    kind,
    contentType,
    unique: crypto.randomUUID(),
  });

  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    // Overwhelmingly this is a missing bucket — the one setup step that is not
    // a migration, and therefore the one a new environment forgets.
    reportError("media.upload", error, { businessId: business.id, kind });
    return {
      ok: false,
      error: "לא הצלחנו להתחיל את ההעלאה. ודאו שאחסון הקבצים מוגדר ונסו שוב.",
    };
  }

  return {
    ok: true,
    uploadUrl: data.signedUrl,
    path: data.path,
    publicUrl: publicMediaUrl(config.url, path),
    // Never null here: the schema already restricted `contentType` to the
    // accepted set, and every member of it maps to one or the other.
    mediaType: mediaTypeOf(contentType) ?? "image",
    apiKey: config.anonKey,
  };
}
