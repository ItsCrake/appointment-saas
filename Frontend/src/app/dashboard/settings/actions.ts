"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isSlugTaken, updateBusiness } from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";

export type SettingsResult = { ok: true } | { ok: false; error: string };

const settingsSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם עסק").max(80, "השם ארוך מדי"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "הכתובת חייבת להכיל לפחות 3 תווים")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "אותיות באנגלית, מספרים ומקפים בלבד"),
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
  notificationEmail: z
    .union([z.email("כתובת אימייל לא תקינה"), z.literal("")])
    .optional(),
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
  });

  revalidatePath("/dashboard/settings");
  revalidatePath(`/${previousSlug}`);
  revalidatePath(`/${data.slug}`);
  return { ok: true };
}
