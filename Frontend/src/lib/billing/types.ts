import type { BillingCycle, PlanType } from "@/lib/plans";

/** Tiers that can actually be bought. `free` is a state, not a product. */
export type PaidPlan = Exclude<PlanType, "free">;

export type CheckoutRequest = {
  businessId: string;
  businessName: string;
  plan: PaidPlan;
  cycle: BillingCycle;
  /** Agorot. Computed server-side from `PRICING_TIERS`, never from the client. */
  amountCents: number;
  /** Where the provider sends the owner afterwards. */
  successUrl: string;
  cancelUrl: string;
  customerEmail: string | null;
  /** Existing provider handle, when the tenant has bought before. */
  providerCustomerId: string | null;
};

export type CheckoutResult =
  /**
   * A real provider hands back a URL to send the browser to. Nothing has been
   * charged at this point — the subscription only moves on the webhook.
   */
  | { ok: true; kind: "redirect"; url: string; providerRef: string }
  /**
   * The console provider has no hosted page to visit, so it reports that the
   * caller should apply the change directly. This is what makes the whole
   * checkout path exercisable before a merchant account exists.
   */
  | { ok: true; kind: "simulated"; providerRef: string }
  | { ok: false; error: string };

export type BillingProvider = {
  /** Shown in logs and in `check:env`, so it is obvious what is actually live. */
  name: string;
  /** False for the console provider. Nothing real can be collected. */
  live: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
};
