"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  createBusiness,
  getBusinessByOwner,
  isSlugTaken,
  replaceWorkingHours,
} from "@/db/queries";
import { requireUser } from "@/lib/dashboard-session";

export type SetupResult = { ok: false; error: string };

const setupSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם עסק").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "הכתובת חייבת להכיל לפחות 3 תווים")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "אותיות באנגלית, מספרים ומקפים בלבד"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

/** Sensible Israeli defaults so a new business is bookable immediately. */
const DEFAULT_SHIFTS = [0, 1, 2, 3, 4].map((weekday) => ({
  weekday,
  startTime: "09:00:00",
  endTime: "17:00:00",
  isClosed: false,
}));

export async function createBusinessAction(
  input: unknown,
): Promise<SetupResult> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const user = await requireUser();

  // One business per owner for now; re-running setup must not create a second.
  const existing = await getBusinessByOwner(db, user.id);
  if (existing) redirect("/dashboard");

  if (await isSlugTaken(db, parsed.data.slug)) {
    return { ok: false, error: "הכתובת הזו כבר תפוסה. בחרו אחרת." };
  }

  const business = await createBusiness(db, {
    ownerUserId: user.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    phone: parsed.data.phone || null,
    timezone: "Asia/Jerusalem",
    locale: "he",
  });

  await replaceWorkingHours(db, business.id, DEFAULT_SHIFTS);

  redirect("/dashboard");
}
