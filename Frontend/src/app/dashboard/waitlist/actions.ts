"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  setWaitlistStatusForBusiness,
  upsertWaitlistEntry,
} from "@/db/queries";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { normalizePhone } from "@/lib/validation";

export type WaitlistActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * **There is no "offer this slot" action, and that is the design.**
 *
 * A cancellation offers its own slot to the front of the queue —
 * `offerFreedSlotToWaitlist`, called from both cancellation paths. This page is
 * where an owner decides *who is in the queue*; nothing here asks them to
 * approve a match, because for every cancellation the answer was always yes.
 */

const statusSchema = z.enum(["active", "booked", "expired", "cancelled"]);

/** Removing somebody, or putting them back. Tenant-scoped. */
export async function setWaitlistEntryStatusAction(
  entryId: string,
  status: string,
): Promise<WaitlistActionResult> {
  const parsedId = z.uuid().safeParse(entryId);
  const parsedStatus = statusSchema.safeParse(status);
  if (!parsedId.success || !parsedStatus.success) {
    return { ok: false, error: "בקשה לא תקינה" };
  }

  const { business } = await requireWritable();

  const updated = await setWaitlistStatusForBusiness(
    db,
    business.id,
    parsedId.data,
    parsedStatus.data,
  );

  if (!updated) return { ok: false, error: "הרישום לא נמצא" };

  revalidatePath("/dashboard/waitlist");
  return { ok: true, message: "הרשימה עודכנה" };
}

const manualSchema = z.object({
  clientName: z.string().trim().min(2, "יש להזין שם").max(80),
  clientPhone: z.string().trim().min(1, "יש להזין טלפון"),
  serviceId: z.union([z.uuid(), z.literal("")]).optional(),
  preferredStaffId: z.union([z.uuid(), z.literal("")]).optional(),
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferredTimeWindow: z
    .enum(["morning", "afternoon", "evening", "any"])
    .default("any"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * The owner adding somebody who rang up.
 *
 * Shares `upsertWaitlistEntry` with the public form, so a client who phoned and
 * then joined online holds one place rather than two — and this is the path that
 * can set a preferred provider, which the public form deliberately does not ask
 * about.
 */
export async function addWaitlistEntryAction(
  input: unknown,
): Promise<WaitlistActionResult> {
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  try {
    const { rejoined } = await upsertWaitlistEntry(db, {
      businessId: business.id,
      clientName: parsed.data.clientName,
      clientPhone: normalizePhone(parsed.data.clientPhone),
      serviceId: parsed.data.serviceId || null,
      preferredStaffId: parsed.data.preferredStaffId || null,
      preferredDays: parsed.data.preferredDays,
      preferredTimeWindow: parsed.data.preferredTimeWindow,
      notes: parsed.data.notes || null,
    });

    revalidatePath("/dashboard/waitlist");
    return {
      ok: true,
      message: rejoined ? "הפרטים עודכנו ברשימה" : "הלקוח נוסף לרשימת ההמתנה",
    };
  } catch (error) {
    reportError("waitlist.add", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בהוספה לרשימה" };
  }
}
