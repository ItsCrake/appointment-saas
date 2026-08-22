"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isSlugTaken, updateBusiness } from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";
import { entitlementsFor } from "@/lib/entitlements";
import { isManageTokenShape } from "@/lib/public-slug";

export type SettingsResult = { ok: true } | { ok: false; error: string };

const settingsSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם עסק").max(80, "השם ארוך מדי"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "הכתובת חייבת להכיל לפחות 3 תווים")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "אותיות באנגלית, מספרים ומקפים בלבד")
    // A UUID-shaped address is routed to a cancellation link before it is ever
    // looked up as a shop — see `isManageTokenShape`.
    .refine((value) => !isManageTokenShape(value), "כתובת זו שמורה למערכת"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  address: z.string().trim().max(160).optional().or(z.literal("")),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  bufferMin: z
    .number()
    .int("מרווח חייב להיות מספר שלם")
    .min(0, "המרווח לא יכול להיות שלילי")
    .max(120, "המרווח גבוה מדי"),
  cancelWindowHours: z
    .number()
    .int()
    .min(0, "החלון לא יכול להיות שלילי")
    .max(168, "החלון גבוה מדי"),
  reminderHoursBefore: z
    .number()
    .int()
    .min(0, "לא יכול להיות שלילי")
    .max(168, "מוקדם מדי"),
  /**
   * Optional so an older client that predates the field still saves, exactly
   * as `requiresApproval` is below.
   *
   * The floor of 15 is not cosmetic: expiry is cycled by the notifications
   * cron, and a window shorter than the sweep interval would lapse offers the
   * shop could not re-offer in time. 0 opts out entirely.
   */
  waitlistOfferTtlMin: z
    .number()
    .int()
    .min(0, "לא יכול להיות שלילי")
    .max(10080, "החלון ארוך מדי")
    .refine(
      (value) => value === 0 || value >= 15,
      "חלון קצר מ-15 דקות אינו נתמך. 0 מבטל פקיעה.",
    )
    .optional(),
  notificationEmail: z
    .union([z.email("כתובת אימייל לא תקינה"), z.literal("")])
    .optional(),
  /** Optional so an older client that predates the toggle still saves. */
  requiresApproval: z.boolean().optional(),
  retentionEnabled: z.boolean().optional(),
});

export async function saveSettingsAction(
  input: unknown,
): Promise<SettingsResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const data = parsed.data;

  // Checked here for a friendly message; the unique index is the real guard.
  if (
    data.slug !== business.slug &&
    (await isSlugTaken(db, data.slug, business.id))
  ) {
    return { ok: false, error: "הכתובת הזו כבר תפוסה. בחרו אחרת." };
  }

  const previousSlug = business.slug;

  await updateBusiness(db, business.id, {
    name: data.name,
    slug: data.slug,
    phone: data.phone || null,
    address: data.address || null,
    description: data.description || null,
    bufferMin: data.bufferMin,
    cancelWindowHours: data.cancelWindowHours,
    reminderHoursBefore: data.reminderHoursBefore,
    notificationEmail: data.notificationEmail || null,
    ...(data.waitlistOfferTtlMin === undefined
      ? {}
      : { waitlistOfferTtlMin: data.waitlistOfferTtlMin }),
    ...(data.requiresApproval === undefined
      ? {}
      : { requiresApproval: data.requiresApproval }),
    /*
     * Gated on the entitlement at the *boundary*, not only in the UI. A server
     * action is a plain POST endpoint, so a hidden switch proves nothing about
     * who can flip it — the same reasoning that makes branding writes check
     * `customBranding` here rather than trusting the settings page.
     */
    ...(data.retentionEnabled === undefined ||
    !entitlementsFor(business).clientRetention
      ? {}
      : { retentionEnabled: data.retentionEnabled }),
  });

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${previousSlug}`);
  revalidatePath(`/${data.slug}`);
  return { ok: true };
}
