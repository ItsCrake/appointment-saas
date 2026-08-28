"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { db } from "@/db";
import { createTimeOff, deleteTimeOff, updateBusiness } from "@/db/queries";
import {
  countStaffAppointments,
  createStaff,
  deactivateSecondaryStaff,
  deleteStaff,
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

/**
 * Turns the team switch on the moment a second provider actually exists.
 *
 * ---------------------------------------------------------------------------
 * **The flag and the roster used to be able to disagree, and the disagreement
 * was invisible.** `has_multiple_staff` decides who is *bookable*, not merely
 * what renders — `resolveBookableStaff` hands the engine `[primary]` while it
 * is off — so a shop that added a second barber and did not also find the
 * toggle had someone on the rota, on the calendar legend and in the dashboard
 * who could never receive a booking. Nothing errored. The owner's evidence
 * that it worked was that the person was visibly there.
 *
 * Adding a provider *is* the answer to "do you have more than one?", so the
 * question stops being asked separately. This only ever turns the flag **on**:
 * the off direction stays manual, because it is destructive
 * (`deactivateSecondaryStaff`) and must not fire because a shop happened to
 * deactivate somebody for a week.
 *
 * Returns whether it flipped, so the caller can say so — a switch that moves
 * without being touched has to be reported, or the next person to open
 * settings finds a setting they did not choose.
 * ---------------------------------------------------------------------------
 */
async function enableMultiStaffIfTeam(business: {
  id: string;
  hasMultipleStaff: boolean;
}): Promise<boolean> {
  if (business.hasMultipleStaff) return false;

  const active = await listActiveStaff(db, business.id);
  if (active.length <= 1) return false;

  await updateBusiness(db, business.id, { hasMultipleStaff: true });
  // The toggle itself lives on this page as well as on /dashboard/staff.
  revalidatePath("/dashboard/settings");
  return true;
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

  // A new provider is created active, so this is the moment the shop becomes a
  // team. See `enableMultiStaffIfTeam` for why the flag cannot be left behind.
  const enabled = await enableMultiStaffIfTeam(business);

  refresh();
  return {
    ok: true,
    message: enabled
      ? "נותן השירות נוסף. ניהול צוות הופעל אוטומטית"
      : "נותן השירות נוסף",
  };
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
 * Activate or deactivate — the operation that applies to anyone with history.
 *
 * `deleteStaffAction` below exists too, but only reaches a provider with no
 * bookings at all: `appointments.staff_id` is `ON DELETE RESTRICT`, so for
 * everybody else this is the only way off the rota, and their history is the
 * reason.
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

  // Reactivating somebody is the other way a shop becomes a team, and it is the
  // easier one to miss: the person was already on the page, greyed out, so
  // nothing about putting them back suggests a tenant setting is involved.
  const enabled = isActive ? await enableMultiStaffIfTeam(business) : false;

  refresh();
  return {
    ok: true,
    message: isActive
      ? enabled
        ? "הופעל מחדש. ניהול צוות הופעל אוטומטית"
        : "הופעל מחדש"
      : "הושבת",
  };
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
 * **Turning it off now deactivates everybody but the primary provider**, where
 * it used to change nothing but the flag. The old note argued a yes/no question
 * should never be destructive, and that reasoning was right about *deletion* and
 * wrong about this: the roster stayed visible on `/dashboard/staff`, the
 * calendar kept a column per person, and the shop was left in a state where the
 * concept was supposedly off and the evidence of it was still on screen.
 *
 * Deactivation is the reversible half of that argument. Nobody is deleted, no
 * history moves, and turning the switch back on is one click per person — the
 * same control an owner already uses to put someone back on the rota.
 *
 * **The longest-serving provider is exempt** — earliest `created_at`, see
 * `longestServing`. Seniority rather than display order, because an owner can
 * rearrange the list but cannot rearrange who has been there longest, and a
 * tenant with no active provider takes no bookings at all.
 *
 * The reverse direction is automatic and lives in `enableMultiStaffIfTeam`:
 * adding or reactivating a second provider turns this back on by itself. Only
 * the *off* direction is manual, because only this one destroys anything.
 */
export async function setMultiStaffAction(
  enabled: boolean,
): Promise<StaffActionResult> {
  const { business } = await requireWritable();

  await updateBusiness(db, business.id, { hasMultipleStaff: enabled });

  let deactivated = 0;
  if (!enabled) {
    deactivated = await deactivateSecondaryStaff(db, business.id);
  }

  refresh();
  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: enabled
      ? "ניהול צוות הופעל"
      : deactivated > 0
        ? `ניהול צוות כובה. ${deactivated === 1 ? "נותן שירות אחד הועבר" : `${deactivated} נותני שירות הועברו`} ללא פעיל`
        : "ניהול צוות כובה",
  };
}

/**
 * Removes a provider entirely, when the database will allow it.
 *
 * `appointments.staff_id` is `ON DELETE RESTRICT`, so anyone who has ever taken
 * a booking **cannot** be deleted — their history is the reason, and cascading
 * it would silently erase appointments an owner may need for tax or for a
 * dispute. That is not a limitation to route around; it is the guarantee.
 *
 * So this deletes only providers with no bookings at all — a name typed twice,
 * someone who never started — and for everyone else it says plainly why not and
 * points at deactivation, which is the operation that actually applies. Doing
 * the check in the application as well as relying on the constraint is what
 * turns a Postgres error into a sentence.
 */
export async function deleteStaffAction(
  staffId: string,
): Promise<StaffActionResult> {
  const { business } = await requireWritable();

  const parsed = z.uuid().safeParse(staffId);
  if (!parsed.success) return { ok: false, error: "מזהה לא תקין" };

  const member = await getStaff(db, business.id, parsed.data);
  if (!member) return { ok: false, error: "נותן השירות לא נמצא" };

  const bookings = await countStaffAppointments(db, business.id, parsed.data);
  if (bookings > 0) {
    return {
      ok: false,
      error: `לא ניתן למחוק — ל${member.name} יש ${bookings} תורים בהיסטוריה. אפשר להעביר ללא פעיל במקום.`,
    };
  }

  // The last active provider cannot go, deleted or deactivated: a tenant with
  // none takes no bookings and the public page stops working with nothing on
  // screen to explain it.
  const active = await listActiveStaff(db, business.id);
  if (member.isActive && active.length <= 1) {
    return {
      ok: false,
      error: "זהו נותן השירות הפעיל האחרון. חייב להישאר אחד לפחות.",
    };
  }

  await deleteStaff(db, business.id, parsed.data);

  refresh();
  return { ok: true, message: `${member.name} נמחק` };
}
