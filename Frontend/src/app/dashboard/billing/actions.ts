"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  activateSubscription,
  cancelAtPeriodEnd,
} from "@/lib/billing/activate";
import { getBillingProvider } from "@/lib/billing/providers";
import { requireWritable } from "@/lib/dashboard-session";
import { reportError, reportWarning } from "@/lib/observability";
import { BILLING_CYCLES, findTier, PRICING_TIERS } from "@/lib/plans";

export type BillingResult =
  { ok: true; message?: string } | { ok: false; error: string };

const checkoutSchema = z.object({
  // Only tiers that are actually sold. `free` is a state, not a purchase.
  plan: z.enum(PRICING_TIERS.map((t) => t.id) as [string, ...string[]]),
  cycle: z.enum(BILLING_CYCLES),
});

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/**
 * Starts checkout for the selected tier.
 *
 * The amount is computed here from `PRICING_TIERS` and never accepted from the
 * client. A price in a request body is a price the browser can edit.
 */
export async function startCheckoutAction(
  input: unknown,
): Promise<BillingResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "המסלול שנבחר אינו תקין" };
  }

  const { business, user } = await requireWritable();
  const tier = findTier(parsed.data.plan);
  if (!tier) return { ok: false, error: "המסלול שנבחר אינו תקין" };

  const cycle = parsed.data.cycle;
  const amountCents = cycle === "yearly" ? tier.yearlyCents : tier.monthlyCents;
  const provider = getBillingProvider();

  let result;
  try {
    result = await provider.createCheckout({
      businessId: business.id,
      businessName: business.name,
      plan: tier.id,
      cycle,
      amountCents,
      successUrl: `${appBaseUrl()}/dashboard/billing`,
      cancelUrl: `${appBaseUrl()}/dashboard/billing`,
      customerEmail: business.notificationEmail ?? user.email ?? null,
      providerCustomerId: business.providerCustomerId,
    });
  } catch (error) {
    reportError("billing.checkout", error, { businessId: business.id });
    return { ok: false, error: "פתיחת התשלום נכשלה. נסו שוב." };
  }

  if (!result.ok) {
    reportWarning("billing.checkout.refused", result.error, {
      businessId: business.id,
      provider: provider.name,
    });
    return {
      ok: false,
      error: "תשלום מקוון אינו זמין כרגע. צרו קשר ונטפל בזה ידנית.",
    };
  }

  if (result.kind === "redirect") {
    // Nothing has been charged yet. The subscription moves on the webhook.
    redirect(result.url);
  }

  // Console provider: no hosted page exists, so the change is applied here.
  // Only reachable outside production — `createCheckout` refuses there.
  try {
    await activateSubscription(db, {
      businessId: business.id,
      plan: tier.id,
      cycle,
      amountCents,
      provider: provider.name,
      providerRef: result.providerRef,
    });
  } catch (error) {
    reportError("billing.activate", error, { businessId: business.id });
    return { ok: false, error: "הפעלת המנוי נכשלה. נסו שוב." };
  }

  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
  return { ok: true, message: `המסלול עודכן ל${tier.name}` };
}

const cancelSchema = z.object({ cancel: z.boolean() });

/**
 * Flips the "cancel when the period ends" intent. Access is not revoked here:
 * the tenant paid through the period, and the provider webhook is what
 * eventually moves the status.
 */
export async function setCancelAtPeriodEndAction(
  input: unknown,
): Promise<BillingResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "בקשה לא תקינה" };

  const { business } = await requireWritable();

  try {
    const found = await cancelAtPeriodEnd(db, business.id, parsed.data.cancel);
    if (!found) return { ok: false, error: "העסק לא נמצא" };
  } catch (error) {
    reportError("billing.cancel", error, { businessId: business.id });
    return { ok: false, error: "עדכון המנוי נכשל. נסו שוב." };
  }

  revalidatePath("/dashboard/billing");
  return {
    ok: true,
    message: parsed.data.cancel
      ? "המנוי יסתיים בתום התקופה"
      : "החידוש האוטומטי הופעל מחדש",
  };
}
