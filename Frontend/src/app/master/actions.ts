"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { extendTrial, getBusinessById, setTenantActive } from "@/db/queries";
import { clearImpersonation, setImpersonation } from "@/lib/impersonation";
import { requireSuperAdmin } from "@/lib/master-session";
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
