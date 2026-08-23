"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { updateBusiness } from "@/db/queries";
import {
  CARD_STYLES,
  CORNER_STYLES,
  HERO_OVERLAY_MAX,
  HERO_OVERLAY_MIN,
  SERVICE_LAYOUTS,
} from "@/lib/appearance";
import {
  gallerySchema,
  mediaUrlSchema,
  reviewsSchema,
  THEME_COLORS,
} from "@/lib/branding";
import { requireWritable } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import { reportError, reportWarning } from "@/lib/observability";

export type AppearanceResult = { ok: true } | { ok: false; error: string };

/**
 * Hero URL and type travel together: a type with no URL renders nothing, and a
 * URL with no type cannot be rendered at all. Migration 0009 has the matching
 * CHECK constraint, so this is the friendly message rather than the guarantee.
 */
const appearanceSchema = z
  .object({
    themeColor: z.enum(THEME_COLORS),
    heroMediaUrl: z.union([mediaUrlSchema, z.literal("")]),
    heroMediaType: z.union([z.enum(["image", "video"]), z.literal("")]),
    galleryUrls: gallerySchema,
    reviews: reviewsSchema,
    /**
     * The dressing (0027). Optional so a client that predates these controls
     * still saves its hero and gallery — the same reasoning `requiresApproval`
     * uses on the settings form.
     */
    cardStyle: z.enum(CARD_STYLES).optional(),
    cornerStyle: z.enum(CORNER_STYLES).optional(),
    serviceLayout: z.enum(SERVICE_LAYOUTS).optional(),
    heroOverlay: z
      .number()
      .int()
      .min(HERO_OVERLAY_MIN)
      .max(HERO_OVERLAY_MAX)
      .optional(),
  })
  .refine((v) => Boolean(v.heroMediaUrl) === Boolean(v.heroMediaType), {
    message: "יש לבחור סוג מדיה יחד עם כתובת הבאנר",
    path: ["heroMediaType"],
  });

export async function saveAppearanceAction(
  input: unknown,
): Promise<AppearanceResult> {
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  // The entitlement check belongs *here*, not only in the form. A server action
  // is a plain POST endpoint: a hidden button proves nothing about who can call
  // it, exactly as `/master` actions re-check the roster rather than trusting
  // the page that rendered them.
  if (!entitlementsFor(business).customBranding) {
    reportWarning("settings.appearance", "branding write refused", {
      businessId: business.id,
      planType: business.planType,
      subscriptionStatus: business.subscriptionStatus,
    });
    return { ok: false, error: "עיצוב מותאם זמין במסלול המקצועי" };
  }

  const data = parsed.data;

  try {
    await updateBusiness(db, business.id, {
      themeColor: data.themeColor,
      heroMediaUrl: data.heroMediaUrl || null,
      heroMediaType: data.heroMediaType || null,
      galleryUrls: data.galleryUrls,
      reviews: data.reviews,
      ...(data.cardStyle === undefined ? {} : { cardStyle: data.cardStyle }),
      ...(data.cornerStyle === undefined
        ? {}
        : { cornerStyle: data.cornerStyle }),
      ...(data.serviceLayout === undefined
        ? {}
        : { serviceLayout: data.serviceLayout }),
      ...(data.heroOverlay === undefined
        ? {}
        : { heroOverlay: data.heroOverlay }),
    });
  } catch (error) {
    // The CHECK constraints can still reject a payload this action considered
    // valid; surfacing the raw driver error would leak SQL to the owner.
    reportError("settings.appearance", error, { businessId: business.id });
    return { ok: false, error: "שמירת העיצוב נכשלה. נסו שוב." };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}
