"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import { createTimeOff, deleteTimeOff, updateBusiness } from "@/db/queries";
import {
  createStaff,
  getStaff,
  listActiveStaff,
  replaceStaffSchedule,
  updateStaff,
} from "@/db/queries/staff";
import { mediaUrlSchema } from "@/lib/branding";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError } from "@/lib/observability";
import { STAFF_COLORS } from "@/lib/staff-colors";

export type StaffActionResult =
  { ok: true; message?: string } | { ok: false; error: string };

const staffSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם").max(60),
  title: z.string().trim().max(60).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  color: z.enum(STAFF_COLORS),
  /**
   * Normally an uploaded URL, but an owner can still paste one — so it goes
   * through the same http(s)-only check as every other media column rather
   * than being trusted because the upload widget usually produced it.
   */
  imageUrl: z.union([mediaUrlSchema, z.literal("")]).optional(),
});

const shiftSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
});

function refresh() {
  revalidatePath("/dashboard/staff");
  // The agenda shows who is taking each appointment, and the public page's
  // availability depends on the roster.
  revalidatePath("/dashboard");
}

export async function createStaffAction(
  input: unknown,
): Promise<StaffActionResult> {
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  try {
    await createStaff(db, {
      businessId: business.id,
      name: parsed.data.name,
      title: parsed.data.title || null,
      phone: parsed.data.phone || null,
      color: parsed.data.color,
      imageUrl: parsed.data.imageUrl || null,
    });
  } catch (error) {
    reportError("staff.create", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בהוספת נותן השירות" };
  }

  refresh();
  return { ok: true, message: "נותן השירות נוסף" };
}

export async function updateStaffAction(
  staffId: string,
  input: unknown,
): Promise<StaffActionResult> {
  const parsedId = z.uuid().safeParse(staffId);
  const parsed = staffSchema.safeParse(input);

  if (!parsedId.success) return { ok: false, error: "בקשה לא תקינה" };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireWritable();

  // Scoped by the session's business, so an id from another tenant does not
  // resolve rather than being updated.
  const updated = await updateStaff(db, business.id, parsedId.data, {
    name: parsed.data.name,
    title: parsed.data.title || null,
    phone: parsed.data.phone || null,
    color: parsed.data.color,
    imageUrl: parsed.data.imageUrl || null,
  });

  if (!updated) return { ok: false, error: "נותן השירות לא נמצא" };

  refresh();
  return { ok: true, message: "הפרטים עודכנו" };
}

/**
 * Activate or deactivate. There is no delete: `appointments.staff_id` is
 * `ON DELETE RESTRICT`, so anyone who has taken a booking cannot be removed at
 * all — their history is the reason. Deactivating is the operation that
 * actually exists.
 */
export async function setStaffActiveAction(
  staffId: string,
  isActive: boolean,
): Promise<StaffActionResult> {
  const parsedId = z.uuid().safeParse(staffId);
  if (!parsedId.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireWritable();

  /**
   * A tenant with no active staff takes no bookings at all — availability
   * returns an empty list for every day, and the public page silently stops
   * working with nothing to explain it. Refusing here is the only place that
   * can say why.
   */
  if (!isActive) {
    const active = await listActiveStaff(db, business.id);
    if (active.length <= 1) {
      return {
        ok: false,
        error:
          "אי אפשר להשבית את נותן השירות היחיד — העסק לא יוכל לקבל תורים. " +
          "הוסיפו נותן שירות נוסף קודם.",
      };
    }
  }

  const updated = await updateStaff(db, business.id, parsedId.data, {
    isActive,
  });
  if (!updated) return { ok: false, error: "נותן השירות לא נמצא" };

  refresh();
  return { ok: true, message: isActive ? "הופעל מחדש" : "הושבת" };
}

/**
 * Replaces one person's weekly template wholesale.
 *
 * An **empty list is meaningful and is not an error**: it means "works the
 * business hours", which is the default every staff member starts on. That is
 * what keeps a shop whose team all work the same hours from filling in seven
 * rows per person.
 */
export async function saveStaffScheduleAction(
  staffId: string,
  shifts: unknown,
): Promise<StaffActionResult> {
  const parsedId = z.uuid().safeParse(staffId);
  const parsed = z.array(shiftSchema).safeParse(shifts);

  if (!parsedId.success) return { ok: false, error: "בקשה לא תקינה" };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  for (const shift of parsed.data) {
    if (shift.endTime <= shift.startTime) {
      return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
    }
  }

  const { business } = await requireWritable();

  // Ownership is checked before the write, because `replaceStaffSchedule`
  // keys on staff_id alone and has no business to scope by.
  const member = await getStaff(db, business.id, parsedId.data);
  if (!member) return { ok: false, error: "נותן השירות לא נמצא" };

  try {
    await replaceStaffSchedule(db, member.id, parsed.data);
  } catch (error) {
    reportError("staff.schedule", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בשמירת השעות" };
  }

  refresh();
  return {
    ok: true,
    message:
      parsed.data.length === 0
        ? "נשמר — נותן השירות עובד לפי שעות העסק"
        : "השעות נשמרו",
  };
}

const timeOffSchema = z.object({
  /** Omitted or empty means a closure of the whole business. */
  staffId: z.uuid().optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה לא תקינה"),
  reason: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function createStaffTimeOffAction(
  input: unknown,
): Promise<StaffActionResult> {
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { staffId, date, startTime, endTime, reason } = parsed.data;
  if (endTime <= startTime) {
    return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
  }

  const { business } = await requireWritable();

  // The composite FK would refuse another tenant's staff anyway, but a
  // constraint violation is a 500 the owner cannot act on; this is the message.
  if (staffId) {
    const member = await getStaff(db, business.id, staffId);
    if (!member) return { ok: false, error: "נותן השירות לא נמצא" };
  }

  try {
    await createTimeOff(db, {
      businessId: business.id,
      staffId: staffId || null,
      startsAt: fromZonedTime(`${date}T${startTime}:00`, business.timezone),
      endsAt: fromZonedTime(`${date}T${endTime}:00`, business.timezone),
      reason: reason || null,
    });
  } catch (error) {
    reportError("staff.timeOff.create", error, { businessId: business.id });
    return { ok: false, error: "אירעה שגיאה בשמירת החסימה" };
  }

  refresh();
  return { ok: true, message: "החסימה נשמרה" };
}

export async function deleteStaffTimeOffAction(
  timeOffId: string,
): Promise<StaffActionResult> {
  const parsedId = z.uuid().safeParse(timeOffId);
  if (!parsedId.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireWritable();

  const removed = await deleteTimeOff(db, business.id, parsedId.data);
  if (!removed) return { ok: false, error: "החסימה לא נמצאה" };

  refresh();
  return { ok: true, message: "החסימה הוסרה" };
}

/**
 * The single binary question, answerable from settings as well as setup.
 *
 * Turning it **off** hides the concept without touching data: every staff row
 * survives, so turning it back on restores the team exactly. Deleting or
 * deactivating people here would make a toggle destructive, which is not what a
 * yes/no question should ever be.
 */
export async function setMultiStaffAction(
  enabled: boolean,
): Promise<StaffActionResult> {
  const { business } = await requireWritable();

  await updateBusiness(db, business.id, { hasMultipleStaff: enabled });

  refresh();
  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: enabled ? "ניהול צוות הופעל" : "ניהול צוות כובה",
  };
}
