import { randomUUID } from "node:crypto";

import { reportWarning } from "@/lib/observability";

import type { BillingProvider, CheckoutRequest, CheckoutResult } from "./types";

/**
 * Providers resolve at call time, the same way `getProvider(channel)` does for
 * notifications: adding credentials switches the live provider on with no code
 * change.
 *
 * **The fallback rule is inverted here, and that is the point.** An
 * unconfigured notification channel falls back to a console provider that
 * reports success and delivers nothing — annoying, recoverable, and the reason
 * the whole outbox was testable before Resend existed. The same fallback in
 * billing would mark tenants as paying without money moving: it would not lose
 * a message, it would invent revenue. So the console provider **refuses
 * outright in production** rather than pretending.
 */

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Development stand-in. Logs, and tells the caller to apply the change
 * directly rather than sending the browser to a hosted page that does not
 * exist.
 */
function consoleProvider(): BillingProvider {
  return {
    name: "console",
    live: false,
    async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
      if (isProduction()) {
        // Fail closed. A production deploy with no provider must not be able
        // to move a subscription to `active`, because nothing was charged.
        return {
          ok: false,
          error:
            "No payment provider is configured. Checkout is disabled in production.",
        };
      }

      reportWarning("billing.checkout.simulated", "console provider checkout", {
        businessId: request.businessId,
        plan: request.plan,
        cycle: request.cycle,
        amountCents: request.amountCents,
      });

      return {
        ok: true,
        kind: "simulated",
        providerRef: `console_${randomUUID()}`,
      };
    },
  };
}

/**
 * Resolves the active provider.
 *
 * Stage 8d adds the concrete adapter (Stripe, or an Israeli provider with
 * native חשבונית מס) behind this same call. It is the only function that needs
 * to learn a new name.
 */
export function getBillingProvider(): BillingProvider {
  // No real adapter exists yet. When one lands it is checked for here, by
  // credentials, exactly like `resendProvider()` and `twilioProvider()`.
  return consoleProvider();
}

/** Whether money can actually be collected under the current environment. */
export function isBillingLive(): boolean {
  return getBillingProvider().live;
}

export function describeBillingProvider() {
  const provider = getBillingProvider();
  return { provider: provider.name, live: provider.live };
}
