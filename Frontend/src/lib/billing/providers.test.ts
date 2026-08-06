import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeBillingProvider,
  getBillingProvider,
  isBillingLive,
} from "@/lib/billing/providers";

const request = {
  businessId: "b1",
  businessName: "מספרת ברקאי",
  plan: "pro" as const,
  cycle: "monthly" as const,
  amountCents: 9900,
  successUrl: "https://example.com/ok",
  cancelUrl: "https://example.com/cancel",
  customerEmail: "owner@example.com",
  providerCustomerId: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("billing provider resolution", () => {
  it("falls back to the console provider while none is configured", () => {
    const provider = getBillingProvider();
    expect(provider.name).toBe("console");
    expect(provider.live).toBe(false);
    expect(isBillingLive()).toBe(false);
    expect(describeBillingProvider()).toEqual({
      provider: "console",
      live: false,
    });
  });
});

describe("console provider", () => {
  it("simulates a checkout outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getBillingProvider().createCheckout(request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("simulated");
      expect(result.providerRef).toMatch(/^console_/);
    }
  });

  it("REFUSES in production instead of pretending to collect", async () => {
    // The inverted fallback rule. An unconfigured notification channel that
    // reports success loses a message; an unconfigured billing provider that
    // reports success invents revenue and marks a tenant as paying.
    vi.stubEnv("NODE_ENV", "production");

    const result = await getBillingProvider().createCheckout(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no payment provider/i);
  });

  it("never reports itself as live, in any environment", async () => {
    for (const env of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(isBillingLive()).toBe(false);
    }
  });
});
