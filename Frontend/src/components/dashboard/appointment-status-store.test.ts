import { describe, expect, it } from "vitest";

import { resolveStatus } from "./appointment-status-store";

/**
 * When the owner's own answer wins, and when it stops winning.
 *
 * This is the whole of what the shared status store guarantees, and the one
 * case that decides it is invisible on screen: a change arriving from a second
 * device. Reproducing that by hand needs two browsers and a race; asserting the
 * rule directly needs neither.
 */
describe("resolveStatus", () => {
  it("shows the server's answer when nothing local has been chosen", () => {
    expect(resolveStatus(null, "pending")).toBe("pending");
  });

  it("shows the owner's answer while the server is still catching up", () => {
    // The optimistic window: they approved, the write is in flight, and the
    // props still carry the value the page was rendered with.
    expect(
      resolveStatus({ status: "confirmed", baseline: "pending" }, "pending"),
    ).toBe("confirmed");
  });

  it("hands authority back once the server agrees", () => {
    // Same answer either way — what matters is that it now comes from the
    // server, so the next thing the server says is not filtered through a
    // local value that has already been honoured.
    expect(
      resolveStatus({ status: "confirmed", baseline: "pending" }, "confirmed"),
    ).toBe("confirmed");
  });

  it("yields to a change that came from somewhere else", () => {
    /**
     * The case this rule exists for. The owner approved on this device; the
     * appointment was then cancelled from their phone, and the revalidated
     * props say `cancelled` — a third value, matching neither the override nor
     * the baseline it was made against.
     *
     * A store that simply preferred the local value would show `confirmed` on a
     * cancelled booking until the page was reloaded, which is the same class of
     * bug as the one this module replaced, only harder to notice.
     */
    expect(
      resolveStatus({ status: "confirmed", baseline: "pending" }, "cancelled"),
    ).toBe("cancelled");
  });

  it("is stable when the same status is re-chosen", () => {
    // Undo sets the previous value back; with the server unchanged that has to
    // resolve to exactly what it says, not to something derived from it.
    expect(
      resolveStatus({ status: "pending", baseline: "pending" }, "pending"),
    ).toBe("pending");
  });
});
