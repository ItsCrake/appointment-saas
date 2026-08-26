"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  createService,
  deactivateService,
  deleteService,
  updateService,
} from "@/db/queries";
import { mediaUrlSchema } from "@/lib/branding";
import { requireWritable } from "@/lib/dashboard-session";

export type ServiceActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

const serviceSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם שירות").max(80, "השם ארוך מדי"),
  description: z.string().trim().max(300).optional().or(z.literal("")),
  durationMin: z
    .number()
    .int("משך חייב להיות מספר שלם")
    .min(5, "משך מינימלי הוא 5 דקות")
    .max(600, "משך מקסימלי הוא 10 שעות"),
  priceCents: z
    .number()
    .int()
    .min(0, "המחיר לא יכול להיות שלילי")
    .max(10_000_00, "המחיר גבוה מדי"),
  /** null inherits businesses.buffer_min; 0 is an explicit "no gap". */
  bufferMin: z
    .number()
    .int("מרווח חייב להיות מספר שלם")
    .min(0, "המרווח לא יכול להיות שלילי")
    .max(120, "המרווח גבוה מדי")
    .nullable()
    .default(null),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  /**
   * The picture on the booking card (0027). Validated as a URL rather than
   * trusted: it is rendered straight into `src`, which is the one place a
   * hostile value would reach a browser. Empty clears it.
   */
  imageUrl: z.union([mediaUrlSchema, z.literal("")]).optional(),
  /**
   * Per-service approval (0029). Optional so a client that predates the toggle
   * still saves; absent means "leave it as it was" rather than "switch it off".
   */
  requiresApproval: z.boolean().optional(),
});

export async function saveServiceAction(
  input: unknown,
  serviceId?: string,
): Promise<ServiceActionResult> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();
  const values = {
    ...parsed.data,
    description: parsed.data.description || null,
    imageUrl: parsed.data.imageUrl ? parsed.data.imageUrl : null,
  };
  if (parsed.data.requiresApproval !== undefined) {
    values.requiresApproval = parsed.data.requiresApproval;
  }

  if (serviceId) {
    const updated = await updateService(db, business.id, serviceId, values);
    if (!updated) return { ok: false, error: "השירות לא נמצא" };
  } else {
    await createService(db, { ...values, businessId: business.id });
  }

  revalidatePath("/dashboard/services");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}

export async function toggleServiceAction(
  serviceId: string,
  isActive: boolean,
): Promise<ServiceActionResult> {
  const { business } = await requireWritable();

  const updated = await updateService(db, business.id, serviceId, { isActive });
  if (!updated) return { ok: false, error: "השירות לא נמצא" };

  revalidatePath("/dashboard/services");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}

/**
 * Tries a hard delete and falls back to deactivating. `appointments.service_id`
 * is ON DELETE RESTRICT, so a service with history cannot be removed without
 * destroying that history.
 */
export async function removeServiceAction(
  serviceId: string,
): Promise<ServiceActionResult> {
  const { business } = await requireWritable();

  try {
    const deleted = await deleteService(db, business.id, serviceId);
    if (!deleted) return { ok: false, error: "השירות לא נמצא" };

    revalidatePath("/dashboard/services");
    revalidatePath(`/${business.slug}`);
    return { ok: true, message: "השירות נמחק" };
  } catch {
    await deactivateService(db, business.id, serviceId);

    revalidatePath("/dashboard/services");
    revalidatePath(`/${business.slug}`);
    return {
      ok: true,
      message: "לשירות יש תורים קיימים, ולכן הוא הוסתר במקום להימחק.",
    };
  }
}
