"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import {
  createTimeOff,
  deleteTimeOff,
  replaceWorkingHours,
} from "@/db/queries";
import { requireBusiness } from "@/lib/dashboard-session";

export type HoursActionResult = { ok: true } | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const shiftSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME, "שעה לא תקינה"),
  endTime: z.string().regex(TIME, "שעה לא תקינה"),
});

const scheduleSchema = z.array(shiftSchema).max(28);

/** Normalises "09:00" to the "09:00:00" the `time` column returns. */
function withSeconds(value: string) {
  return value.length === 5 ? `${value}:00` : value;
}

export async function saveWorkingHoursAction(
  input: unknown,
): Promise<HoursActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  for (const shift of parsed.data) {
    if (withSeconds(shift.endTime) <= withSeconds(shift.startTime)) {
      return {
        ok: false,
        error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה בכל משמרת",
      };
    }
  }

  // The unique (business, weekday, start_time) key would reject duplicates at
  // the DB level; catching it here gives a readable message instead.
  const seen = new Set<string>();
  for (const shift of parsed.data) {
    const key = `${shift.weekday}-${withSeconds(shift.startTime)}`;
    if (seen.has(key)) {
      return { ok: false, error: "יש שתי משמרות שמתחילות באותה שעה באותו יום" };
    }
    seen.add(key);
  }

  const { business } = await requireBusiness();

  await replaceWorkingHours(
    db,
    business.id,
    parsed.data.map((shift) => ({
      weekday: shift.weekday,
      startTime: withSeconds(shift.startTime),
      endTime: withSeconds(shift.endTime),
      isClosed: false,
    })),
  );

  revalidatePath("/dashboard/hours");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}

const timeOffSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין"),
  startTime: z.string().regex(TIME, "שעה לא תקינה"),
  endTime: z.string().regex(TIME, "שעה לא תקינה"),
  reason: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function createTimeOffAction(
  input: unknown,
): Promise<HoursActionResult> {
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireBusiness();
  const { date, startTime, endTime, reason } = parsed.data;

  // The owner types local wall-clock time; the column stores UTC.
  const startsAt = fromZonedTime(
    `${date}T${withSeconds(startTime)}`,
    business.timezone,
  );
  const endsAt = fromZonedTime(
    `${date}T${withSeconds(endTime)}`,
    business.timezone,
  );

  if (endsAt <= startsAt) {
    return { ok: false, error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה" };
  }

  await createTimeOff(db, {
    businessId: business.id,
    startsAt,
    endsAt,
    reason: reason || null,
  });

  revalidatePath("/dashboard/hours");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}

export async function deleteTimeOffAction(
  timeOffId: string,
): Promise<HoursActionResult> {
  const parsed = z.uuid().safeParse(timeOffId);
  if (!parsed.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireBusiness();

  const deleted = await deleteTimeOff(db, business.id, parsed.data);
  if (!deleted) return { ok: false, error: "החסימה לא נמצאה" };

  revalidatePath("/dashboard/hours");
  revalidatePath(`/${business.slug}`);
  return { ok: true };
}
