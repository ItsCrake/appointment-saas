"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  completeOnboarding,
  createBusiness,
  createService,
  getBusinessByOwner,
  isSlugTaken,
  listServices,
  replaceWorkingHours,
  updateBusiness,
} from "@/db/queries";
import { requireBusinessForSetup, requireUser } from "@/lib/dashboard-session";
import { ONBOARDING_PRESETS } from "@/lib/onboarding-presets";
import { PLAN_TYPES, TRIAL_DAYS } from "@/lib/plans";
import { isManageTokenShape } from "@/lib/public-slug";

export type SetupResult =
  { ok: true; next: string } | { ok: false; error: string };

const detailsSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם עסק").max(80),
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
  /**
   * The starting point chosen in step 0, arriving as a query param because that
   * step runs before this row exists. Optional so an owner who deep-linked
   * straight to `?step=details` still saves — a missing preset is a real state,
   * not a validation failure.
   */
  preset: z.enum(ONBOARDING_PRESETS).nullish(),
});

// Sensible Israeli defaults, shown for confirmation in step 3. Not exported:
// a "use server" module may only export async functions.
const DEFAULT_SHIFTS = [0, 1, 2, 3, 4].map((weekday) => ({
  weekday,
  startTime: "09:00:00",
  endTime: "17:00:00",
  isClosed: false,
}));

/**
 * Step 1. Creates the business immediately — an owner who abandons the flow
 * here still has a working account rather than nothing. Re-submitting updates
 * the existing row instead of failing on the unique slug.
 */
export async function saveBusinessDetailsAction(
  input: unknown,
): Promise<SetupResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const user = await requireUser();
  const existing = await getBusinessByOwner(db, user.id);
  const { name, slug, phone, preset } = parsed.data;

  if (await isSlugTaken(db, slug, existing?.id)) {
    return { ok: false, error: "הכתובת הזו כבר תפוסה. בחרו אחרת." };
  }

  if (existing) {
    await updateBusiness(db, existing.id, {
      name,
      slug,
      phone: phone || null,
      /**
       * Re-recorded on the way back through, so an owner who steps back to
       * change their trade gets the new one — but never cleared by a submit
       * that carries no preset, which is what a deep link to `?step=details`
       * looks like.
       */
      ...(preset ? { onboardingPreset: preset } : {}),
    });
  } else {
    const business = await createBusiness(db, {
      ownerUserId: user.id,
      name,
      slug,
      phone: phone || null,
      timezone: "Asia/Jerusalem",
      locale: "he",
      onboardingPreset: preset ?? null,
      // The trial clock starts here, and nowhere else.
      //
      // Until now nothing ever wrote this column: migration 0011 backfilled
      // existing rows and `/master` could extend it, but a tenant who signed
      // up got NULL. That left the entire lifecycle dead for every new
      // account — the sweep only considers rows with a clock, so they would
      // never be warned, never lapse and never be frozen. They would simply
      // sit in `trialing` forever, holding full Pro entitlements for free.
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
    });
    // Seed the default week so step 3 has something to confirm.
    await replaceWorkingHours(db, business.id, DEFAULT_SHIFTS);
  }

  revalidatePath("/dashboard/setup");
  return { ok: true, next: "services" };
}

const starterSchema = z.object({
  services: z
    .array(
      z.object({
        name: z.string().trim().min(2, "יש להזין שם שירות").max(80),
        durationMin: z.number().int().min(5).max(600),
        priceCents: z.number().int().min(0).max(10_000_00),
      }),
    )
    .min(1, "יש להוסיף לפחות שירות אחד")
    .max(20),
});

/**
 * Step 2. Only inserts services the business does not already have, so going
 * back and forward through the flow cannot create duplicates.
 */
export async function saveStarterServicesAction(
  input: unknown,
): Promise<SetupResult> {
  const parsed = starterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { business } = await requireBusinessForSetup();
  if (!business) return { ok: false, error: "יש להשלים קודם את פרטי העסק" };

  const existing = await listServices(db, business.id, { activeOnly: false });
  const existingNames = new Set(existing.map((s) => s.name.trim()));

  let sortOrder = existing.length;
  for (const service of parsed.data.services) {
    if (existingNames.has(service.name.trim())) continue;

    await createService(db, {
      businessId: business.id,
      name: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
      sortOrder: ++sortOrder,
    });
  }

  revalidatePath("/dashboard/setup");
  revalidatePath(`/${business.slug}`);
  return { ok: true, next: "hours" };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const hoursSchema = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startTime: z.string().regex(TIME, "שעה לא תקינה"),
      endTime: z.string().regex(TIME, "שעה לא תקינה"),
    }),
  )
  .max(28);

const withSeconds = (value: string) =>
  value.length === 5 ? `${value}:00` : value;

/** Step 3. Same validation as the settings editor, then straight to finish. */
export async function saveSetupHoursAction(
  input: unknown,
): Promise<SetupResult> {
  const parsed = hoursSchema.safeParse(input);
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

  const seen = new Set<string>();
  for (const shift of parsed.data) {
    const key = `${shift.weekday}-${withSeconds(shift.startTime)}`;
    if (seen.has(key)) {
      return { ok: false, error: "יש שתי משמרות שמתחילות באותה שעה באותו יום" };
    }
    seen.add(key);
  }

  const { business } = await requireBusinessForSetup();
  if (!business) return { ok: false, error: "יש להשלים קודם את פרטי העסק" };

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

  revalidatePath("/dashboard/setup");
  revalidatePath(`/${business.slug}`);
  return { ok: true, next: "plan" };
}

/**
 * Step 4. Records the tier the owner picked. Nothing is charged and nothing is
 * gated on it — there is no payment provider — so this is a stated preference,
 * not an entitlement. Kept as its own step so the choice is deliberate rather
 * than a checkbox on the finish screen.
 */
export async function savePlanAction(input: unknown): Promise<SetupResult> {
  const parsed = z.object({ planType: z.enum(PLAN_TYPES) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "יש לבחור מסלול" };
  }

  const { business } = await requireBusinessForSetup();
  if (!business) return { ok: false, error: "יש להשלים קודם את פרטי העסק" };

  await updateBusiness(db, business.id, { planType: parsed.data.planType });

  revalidatePath("/dashboard/setup");
  return { ok: true, next: "done" };
}

/**
 * Step 5. Marks onboarding complete, which is what stops requireBusiness()
 * from routing the owner back here.
 */
export async function completeOnboardingAction(): Promise<SetupResult> {
  const { business } = await requireBusinessForSetup();
  if (!business) return { ok: false, error: "יש להשלים קודם את פרטי העסק" };

  const services = await listServices(db, business.id);
  if (services.length === 0) {
    return { ok: false, error: "יש להגדיר לפחות שירות אחד לפני הסיום" };
  }

  await completeOnboarding(db, business.id);

  revalidatePath("/dashboard");
  return { ok: true, next: "/dashboard" };
}
