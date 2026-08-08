"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { updateBusiness } from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { normaliseHandle, toProfileUrl } from "@/lib/social-links";

export type ProfileActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

/**
 * Stored as the owner typed it, minus decoration.
 *
 * `toProfileUrl` is what turns a stored value into a link, and it runs again on
 * every read — so the only job here is to reject what could never become one,
 * and to strip the `@` and trailing slashes people paste along with a handle.
 * Storing the resolved URL instead would freeze today's parsing into the row
 * and lose the owner's own text the moment they wanted to edit it.
 */
const socialSchema = z.object({
  instagram: z.string().trim().max(200).optional().or(z.literal("")),
  facebook: z.string().trim().max(200).optional().or(z.literal("")),
  tiktok: z.string().trim().max(200).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(40).optional().or(z.literal("")),
  website: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function saveSocialLinksAction(
  input: unknown,
): Promise<ProfileActionResult> {
  const parsed = socialSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const values = parsed.data;

  /**
   * Rejected here rather than silently dropped on read. A value that will never
   * render an icon is a value the owner believes is working — telling them at
   * the point they type it is the only moment it is cheap to fix.
   */
  const invalid = (
    ["instagram", "facebook", "tiktok", "whatsapp", "website"] as const
  ).filter((platform) => {
    const value = values[platform];
    return Boolean(value) && toProfileUrl(platform, value) === null;
  });

  if (invalid.length > 0) {
    const LABELS: Record<string, string> = {
      instagram: "אינסטגרם",
      facebook: "פייסבוק",
      tiktok: "טיקטוק",
      whatsapp: "וואטסאפ",
      website: "אתר",
    };
    return {
      ok: false,
      error: `הערך שהוזן ב${LABELS[invalid[0]]} אינו תקין. אפשר להזין שם משתמש או כתובת מלאה.`,
    };
  }

  try {
    await updateBusiness(db, business.id, {
      socialInstagram: values.instagram
        ? normaliseHandle(values.instagram)
        : null,
      socialFacebook: values.facebook ? normaliseHandle(values.facebook) : null,
      socialTiktok: values.tiktok ? normaliseHandle(values.tiktok) : null,
      // Left as typed: `normaliseWhatsapp` runs on read and the owner should
      // still see the number in the form they recognise.
      socialWhatsapp: values.whatsapp || null,
      websiteUrl: values.website || null,
    });
  } catch (error) {
    reportError("settings.social", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בשמירת הקישורים" };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${business.slug}`);
  return { ok: true, message: "הקישורים נשמרו" };
}

const depositSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["manual", "gateway"]),
  /** Shekels in the form; agorot in the column. */
  amount: z
    .number()
    .int("יש להזין סכום שלם")
    .min(0, "הסכום לא יכול להיות שלילי")
    .max(100_000, "הסכום גבוה מדי"),
  bitPhone: z.string().trim().max(40).optional().or(z.literal("")),
  paymentUrl: z.string().trim().max(300).optional().or(z.literal("")),
  instructions: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Deposit configuration.
 *
 * **The feature is still off everywhere else.** Nothing reads these columns in
 * the booking flow, no appointment is created with `pending_deposit`, and
 * turning the switch on changes nothing a client can see. It is here so a
 * tenant can be configured before the flow that uses it exists, and so the
 * shape of the settings is exercised rather than assumed.
 *
 * Stated in the UI rather than hidden, because a switch that appears to do
 * something and does not is worse than one labelled as coming soon.
 */
export async function saveDepositSettingsAction(
  input: unknown,
): Promise<ProfileActionResult> {
  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const values = parsed.data;

  // Enabling with nothing for the client to pay *into* would produce a booking
  // that asks for money and says nowhere to send it.
  if (values.enabled && values.mode === "manual") {
    if (!values.bitPhone && !values.paymentUrl) {
      return {
        ok: false,
        error: "כדי להפעיל מקדמה ידנית צריך מספר לביט או קישור לתשלום.",
      };
    }
    if (values.amount <= 0) {
      return { ok: false, error: "יש להזין סכום מקדמה גדול מאפס." };
    }
  }

  try {
    await updateBusiness(db, business.id, {
      depositEnabled: values.enabled,
      depositMode: values.mode,
      depositAmountCents: values.amount * 100,
      depositBitPhone: values.bitPhone || null,
      depositPaymentUrl: values.paymentUrl || null,
      depositInstructions: values.instructions || null,
    });
  } catch (error) {
    reportError("settings.deposit", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בשמירת הגדרות המקדמה" };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true, message: "הגדרות המקדמה נשמרו" };
}
