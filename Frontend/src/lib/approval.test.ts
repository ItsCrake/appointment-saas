import { describe, expect, it } from "vitest";

import { bookingStatusFor, requiresApprovalFor } from "@/lib/approval";

/**
 * Per-service approval (0029).
 *
 * The rule is one OR, and the only thing worth testing is the direction it
 * runs: a per-service flag may **add** vetting to a shop that auto-confirms,
 * and may never **remove** it from a shop that vets everything. Getting that
 * backwards would mean every new service silently punched a hole in a decision
 * the owner made about their whole shop.
 */

const shop = (requiresApproval: boolean) => ({ requiresApproval });

describe("requiresApprovalFor", () => {
  it("auto-confirms when neither flag is set", () => {
    expect(
      requiresApprovalFor({ business: shop(false), service: shop(false) }),
    ).toBe(false);
  });

  it("vets when the service alone asks for it", () => {
    // The case the feature exists for: a barber happy to auto-confirm a child's
    // cut but who wants a word before a three-hour colour.
    expect(
      requiresApprovalFor({ business: shop(false), service: shop(true) }),
    ).toBe(true);
  });

  it("keeps vetting when the shop asks for it, whatever the service says", () => {
    /**
     * The direction that matters. A service defaults to `false`, so if this
     * OR were an override every service added to a vetting shop would quietly
     * start auto-confirming — a new row weakening a shop-wide decision.
     */
    expect(
      requiresApprovalFor({ business: shop(true), service: shop(false) }),
    ).toBe(true);
    expect(
      requiresApprovalFor({ business: shop(true), service: shop(true) }),
    ).toBe(true);
  });
});

describe("bookingStatusFor", () => {
  it("maps the rule onto the two statuses a client booking can take", () => {
    expect(
      bookingStatusFor({ business: shop(false), service: shop(false) }),
    ).toBe("confirmed");
    expect(
      bookingStatusFor({ business: shop(false), service: shop(true) }),
    ).toBe("pending");
  });

  it("never returns a terminal or deposit status", () => {
    /**
     * `pending` is non-terminal, so the exclusion constraint holds the slot
     * while the owner decides. Returning anything terminal here would release
     * the time the client thinks they have.
     */
    for (const business of [true, false]) {
      for (const service of [true, false]) {
        const status = bookingStatusFor({
          business: shop(business),
          service: shop(service),
        });
        expect(["pending", "confirmed"]).toContain(status);
      }
    }
  });
});
