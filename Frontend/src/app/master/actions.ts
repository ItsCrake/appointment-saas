"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  createPendingBusiness,
  extendTrial,
  getBusinessById,
  isSlugTaken,
  replaceWorkingHours,
  setTenantActive,
  setTenantPlan,
  setWhatsappDispatchDisabled,
} from "@/db/queries";
import { ASSIGNABLE_PLANS, planLabel, toPlanType } from "@/lib/plans";
import { clearImpersonation, setImpersonation } from "@/lib/impersonation";
import { requireSuperAdmin } from "@/lib/master-session";
import { isManageTokenShape } from "@/lib/public-slug";
import { reportError, reportWarning } from "@/lib/observability";

export type MasterResult =
  { ok: true; message?: string } | { ok: false; error: string };

const idSchema = z.object({ businessId: z.uuid("מזהה עסק לא תקין") });

/**
 * Every action re-runs `requireSuperAdmin()`. Server actions are ordinary POST
 * endpoints — being rendered inside `/master` proves nothing about who is
 * calling them, so the page guard is not reused as an action guard.
 */

export async function impersonateAction(input: unknown): Promise<MasterResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };

  const admin = await requireSuperAdmin();
  const target = await getBusinessById(db, parsed.data.businessId);
  if (!target) return { ok: false, error: "העסק לא נמצא" };

  // Audit trail. Impersonation is the one action here that can read a tenant's
  // entire client list, so both ends of the session are recorded with the
  // admin's own id — never the tenant's.
  reportWarning("master.impersonate.start", "super admin entered a tenant", {
    adminUserId: admin.id,
    businessId: target.id,
    businessSlug: target.slug,
  });

  await setImpersonation(target.id);
  redirect("/dashboard");
}

export async function stopImpersonationAction(): Promise<void> {
  // No super-admin check: this only ever removes access. Requiring the role to
  // *stop* would strand anyone whose roster entry changed mid-session.
  await clearImpersonation();
  reportWarning("master.impersonate.stop", "impersonation ended");
  redirect("/master");
}

const extendSchema = idSchema.extend({
  days: z.number().int().min(1).max(90),
});

export async function extendTrialAction(input: unknown): Promise<MasterResult> {
  const parsed = extendSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };

  const admin = await requireSuperAdmin();

  try {
    const until = await extendTrial(
      db,
      parsed.data.businessId,
      parsed.data.days,
      new Date(),
    );
    if (!until) return { ok: false, error: "העסק לא נמצא" };

    reportWarning("master.trial.extend", "trial extended", {
      adminUserId: admin.id,
      businessId: parsed.data.businessId,
      days: parsed.data.days,
    });

    revalidatePath("/master");
    revalidatePath("/master/businesses");
    return { ok: true, message: `הניסיון הוארך ב-${parsed.data.days} ימים` };
  } catch (error) {
    reportError("master.trial.extend", error, {
      businessId: parsed.data.businessId,
    });
    return { ok: false, error: "הארכת הניסיון נכשלה" };
  }
}

/**
 * Only the tiers a human may assign, and the enum is built from
 * `ASSIGNABLE_PLANS` rather than written out — so a third tier added to the
 * pricing table becomes selectable here without anyone remembering to come
 * back, and `free` stays unassignable without a second list to keep in step.
 */
const planSchema = idSchema.extend({
  planType: z.enum(ASSIGNABLE_PLANS as [string, ...string[]], {
    message: "מסלול לא תקין",
  }),
});

/**
 * Moves a tenant between paid tiers by hand — support, migrations, and the
 * "they paid me by bank transfer" case that has no webhook behind it.
 *
 * **It writes `plan_type` and never `subscription_status`.** That line is the
 * safety property. Status is what says money is arriving; a support control
 * that could set it to `active` would be inventing revenue, which is precisely
 * what the console billing provider refuses to do in production. Assigning a
 * tier says *which* product they get, not that they have paid for it.
 *
 * The consequence is worth stating because it looks like a bug from the
 * console: on a **trialing** tenant this changes nothing they can see, because
 * a trial grants `TRIAL_PLAN` whatever tier is stored — it sets what they drop
 * to when the trial ends. On a `past_due` or `cancelled` tenant it also changes
 * nothing until they are paying again. It bites immediately only on `active`.
 * The table surfaces the effective plan beside the stored one for that reason.
 */
export async function updateTenantPlanAction(
  input: unknown,
): Promise<MasterResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };

  const admin = await requireSuperAdmin();

  // Resolved before the write, for the slug the revalidation needs and to turn
  // "no such tenant" into a sentence rather than a silent no-op update.
  const target = await getBusinessById(db, parsed.data.businessId);
  if (!target) return { ok: false, error: "העסק לא נמצא" };

  const planType = toPlanType(parsed.data.planType);

  try {
    const found = await setTenantPlan(db, parsed.data.businessId, planType);
    if (!found) return { ok: false, error: "העסק לא נמצא" };

    // Money-adjacent, so it is logged at the same level as impersonation and
    // freezing — with the admin's own id, never the tenant's.
    reportWarning("master.tenant.plan", "tenant plan changed by admin", {
      adminUserId: admin.id,
      businessId: parsed.data.businessId,
      from: target.planType,
      to: planType,
    });

    revalidatePath("/master");
    revalidatePath("/master/businesses");
    // The tenant's own surfaces are `force-dynamic`, so nothing is actually
    // cached to drop — this is here so a future move to a cached render cannot
    // leave an owner looking at the tier they used to be on.
    revalidatePath("/dashboard");
    revalidatePath(`/${target.slug}`);

    return { ok: true, message: `המסלול עודכן ל${planLabel(planType)}` };
  } catch (error) {
    reportError("master.tenant.plan", error, {
      businessId: parsed.data.businessId,
    });
    return { ok: false, error: "עדכון המסלול נכשל" };
  }
}

const toggleSchema = idSchema.extend({ isActive: z.boolean() });

export async function setTenantActiveAction(
  input: unknown,
): Promise<MasterResult> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };

  const admin = await requireSuperAdmin();

  try {
    const found = await setTenantActive(
      db,
      parsed.data.businessId,
      parsed.data.isActive,
    );
    if (!found) return { ok: false, error: "העסק לא נמצא" };

    // Freezing takes a tenant's public booking page offline, so it is logged
    // at the same level as impersonation rather than silently.
    reportWarning("master.tenant.active", "tenant availability changed", {
      adminUserId: admin.id,
      businessId: parsed.data.businessId,
      isActive: parsed.data.isActive,
    });

    revalidatePath("/master");
    revalidatePath("/master/businesses");
    return {
      ok: true,
      message: parsed.data.isActive ? "העסק הופעל" : "העסק הוקפא",
    };
  } catch (error) {
    reportError("master.tenant.active", error, {
      businessId: parsed.data.businessId,
    });
    return { ok: false, error: "עדכון הסטטוס נכשל" };
  }
}

/**
 * The WhatsApp cost guard, flipped from the console.
 *
 * Re-runs `requireSuperAdmin()` like every action in this file — being rendered
 * inside `/master` proves nothing about who is POSTing.
 *
 * It can only ever change the *console* half. `DISABLE_WHATSAPP_DISPATCH` is
 * unreachable from here by design: the environment is the deploy-time guard,
 * and a button in a web UI must not be able to start spending money on a deploy
 * whose environment deliberately said no. Turning this off while the variable is
 * set therefore changes nothing, and the UI says so rather than appearing to
 * work.
 */
export async function setWhatsappDispatchAction(
  input: unknown,
): Promise<MasterResult> {
  const parsed = z.object({ disabled: z.boolean() }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message };

  const admin = await requireSuperAdmin();

  try {
    const row = await setWhatsappDispatchDisabled(
      db,
      parsed.data.disabled,
      admin.email,
    );
    if (!row) return { ok: false, error: "טבלת ההגדרות לא נמצאה" };

    revalidatePath("/master");

    return {
      ok: true,
      message: parsed.data.disabled
        ? "שליחת וואטסאפ הושבתה"
        : "שליחת וואטסאפ הופעלה",
    };
  } catch (error) {
    reportError("master.setWhatsappDispatch", error, {
      disabled: parsed.data.disabled,
    });
    return { ok: false, error: "העדכון נכשל" };
  }
}

const createBusinessSchema = z.object({
  name: z.string().trim().min(2, "יש להזין שם עסק").max(80, "השם ארוך מדי"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "הכתובת חייבת להכיל לפחות 3 תווים")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "אותיות באנגלית, מספרים ומקפים בלבד")
    // A UUID-shaped address resolves to a cancellation link before it is ever
    // looked up as a shop — the same refusal both owner-facing forms make.
    .refine((value) => !isManageTokenShape(value), "כתובת זו שמורה למערכת"),
  ownerEmail: z.email("כתובת אימייל לא תקינה").max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
});

/**
 * Creates a shop for a pilot and names the address that will run it (0028).
 *
 * ---------------------------------------------------------------------------
 * **The owner does not need an account yet, and is never sent a password.**
 * The address is recorded on the row; the first time that person signs in — by
 * any route, including the reset-password flow — `businessForOwnerOrClaim`
 * binds the shop to them. Nothing here creates a user, sets a credential, or
 * emails anybody, which is deliberate: this platform has exactly one way to
 * become authenticated and inventing a second for onboarding would be a second
 * thing to get wrong.
 *
 * Until it is claimed the row is owned by the operator who created it, so RLS
 * keeps it away from every tenant on the platform, and `getBusinessByOwner`
 * keeps it out of the operator's own dashboard. See migration 0028.
 *
 * The slug uniqueness check is a friendly message, not the guarantee — the
 * unique index is. Likewise the pending-email check: the partial unique index
 * is what actually stops one address waiting for two shops.
 * ---------------------------------------------------------------------------
 */
export async function createBusinessForOwnerAction(
  input: unknown,
): Promise<MasterResult> {
  const admin = await requireSuperAdmin();

  const parsed = createBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { name, slug, ownerEmail, phone } = parsed.data;

  if (await isSlugTaken(db, slug)) {
    return { ok: false, error: "הכתובת הזו כבר תפוסה. בחרו אחרת." };
  }

  try {
    const created = await createPendingBusiness(db, {
      operatorUserId: admin.id,
      pendingOwnerEmail: ownerEmail,
      name,
      slug,
      phone: phone || null,
    });

    // The default week, so the shop the owner inherits is bookable rather than
    // closed every day — the same seed `saveBusinessDetailsAction` applies.
    await replaceWorkingHours(
      db,
      created.id,
      [0, 1, 2, 3, 4].map((weekday) => ({
        weekday,
        startTime: "09:00:00",
        endTime: "17:00:00",
        isClosed: false,
      })),
    );

    reportWarning("master.createBusiness", "business created for pilot owner", {
      businessId: created.id,
      operatorId: admin.id,
    });

    revalidatePath("/master/businesses");
    return {
      ok: true,
      message: `נוצר "${created.name}". ישויך ל-${ownerEmail} בהתחברות הראשונה.`,
    };
  } catch (error) {
    /**
     * The partial unique index on `lower(pending_owner_email)` is the most
     * likely thing to reject this, and its raw message names a constraint the
     * operator has no use for. Reported with the detail, answered without it.
     */
    reportError("master.createBusiness", error, { operatorId: admin.id });
    return {
      ok: false,
      error: "יצירת העסק נכשלה. ייתכן שכתובת זו כבר ממתינה לעסק אחר.",
    };
  }
}
