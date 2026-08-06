import { eq } from "drizzle-orm";

import { businesses, invoices, subscriptionEvents } from "@/db/schema";
import type { Database } from "@/db/types";
import { reportWarning } from "@/lib/observability";
import type { BillingCycle } from "@/lib/plans";

import { canAutoUnfreeze } from "./lifecycle";
import type { PaidPlan } from "./types";

/**
 * The single place a subscription becomes `active`.
 *
 * Both the checkout flow and (in 8d) the provider webhook land here, so the
 * state transition, the invoice and the audit row cannot drift apart between
 * two call sites.
 */

export type ActivateInput = {
  businessId: string;
  plan: PaidPlan;
  cycle: BillingCycle;
  amountCents: number;
  provider: string;
  /** Provider's own id for this payment. Also the idempotency key. */
  providerRef: string;
  now?: Date;
};

function periodEnd(cycle: BillingCycle, from: Date): Date {
  const end = new Date(from);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

export async function activateSubscription(
  db: Database,
  {
    businessId,
    plan,
    cycle,
    amountCents,
    provider,
    providerRef,
    now = new Date(),
  }: ActivateInput,
) {
  const [current] = await db
    .select({
      isActive: businesses.isActive,
      frozenReason: businesses.frozenReason,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!current) return null;

  // A payment lifts a billing freeze and never an admin one. Without this
  // check a tenant frozen for abuse could buy their way back in.
  const thaw = canAutoUnfreeze(current);

  const ends = periodEnd(cycle, now);

  await db
    .update(businesses)
    .set({
      subscriptionStatus: "active",
      planType: plan,
      billingCycle: cycle,
      currentPeriodEnd: ends,
      cancelAtPeriodEnd: false,
      // The clock stops. Leaving it set would let the sweep freeze a tenant
      // who has just paid.
      graceStartedAt: null,
      ...(thaw ? { isActive: true, frozenReason: null } : {}),
    })
    .where(eq(businesses.id, businessId));

  await db
    .insert(invoices)
    .values({
      businessId,
      provider,
      providerInvoiceId: providerRef,
      amountCents,
      status: "paid",
      periodStart: now,
      periodEnd: ends,
      issuedAt: now,
      paidAt: now,
    })
    // The unique index on (provider, provider_invoice_id) makes a retried
    // webhook a no-op rather than a second invoice for one payment.
    .onConflictDoNothing();

  await db
    .insert(subscriptionEvents)
    .values({
      businessId,
      provider,
      providerEventId: providerRef,
      eventType: "checkout.completed",
      payload: { plan, cycle, amountCents },
      status: "processed",
      processedAt: now,
    })
    .onConflictDoNothing();

  if (thaw) {
    reportWarning("billing.unfreeze", "billing freeze lifted by payment", {
      businessId,
    });
  }

  return { plan, cycle, currentPeriodEnd: ends, unfrozen: thaw };
}

/**
 * Owner-initiated cancellation. Deliberately does **not** revoke access: they
 * paid through the end of the period, so the subscription stays `active` and
 * `cancel_at_period_end` records the intent. The provider webhook (8d) is what
 * eventually moves it to `cancelled`.
 */
export async function cancelAtPeriodEnd(
  db: Database,
  businessId: string,
  cancel: boolean,
) {
  const [row] = await db
    .update(businesses)
    .set({ cancelAtPeriodEnd: cancel })
    .where(eq(businesses.id, businessId))
    .returning({ id: businesses.id });

  return Boolean(row);
}
