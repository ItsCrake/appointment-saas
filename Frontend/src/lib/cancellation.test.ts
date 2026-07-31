import { describe, expect, it } from "vitest";

import { getCancellationState } from "@/lib/cancellation";

const START = new Date("2026-08-03T09:00:00Z");
const WINDOW = 12; // hours

function at(iso: string) {
  return getCancellationState(
    { status: "confirmed", startsAt: START },
    WINDOW,
    new Date(iso),
  );
}

describe("getCancellationState", () => {
  it("allows cancelling well before the deadline", () => {
    const state = at("2026-08-01T09:00:00Z");
    expect(state.canCancel).toBe(true);
    expect(state.withinWindow).toBe(true);
    expect(state.isPast).toBe(false);
  });

  it("allows cancelling at the exact deadline", () => {
    // 12 hours before start.
    expect(at("2026-08-02T21:00:00Z").canCancel).toBe(true);
  });

  it("blocks one minute after the deadline", () => {
    const state = at("2026-08-02T21:01:00Z");
    expect(state.canCancel).toBe(false);
    expect(state.withinWindow).toBe(false);
    expect(state.isPast).toBe(false); // still upcoming, just too late
  });

  it("blocks once the appointment has started", () => {
    const state = at("2026-08-03T09:30:00Z");
    expect(state.canCancel).toBe(false);
    expect(state.isPast).toBe(true);
  });

  it("reports an already-cancelled booking and refuses a second cancel", () => {
    const state = getCancellationState(
      { status: "cancelled", startsAt: START },
      WINDOW,
      new Date("2026-08-01T09:00:00Z"),
    );
    expect(state.isCancelled).toBe(true);
    expect(state.canCancel).toBe(false);
  });

  it.each(["completed", "no_show"])(
    "refuses to cancel a %s booking",
    (status) => {
      const state = getCancellationState(
        { status, startsAt: START },
        WINDOW,
        new Date("2026-08-01T09:00:00Z"),
      );
      expect(state.canCancel).toBe(false);
    },
  );

  it("treats a zero-hour window as cancellable right up to the start", () => {
    const state = getCancellationState(
      { status: "confirmed", startsAt: START },
      0,
      new Date("2026-08-03T08:59:00Z"),
    );
    expect(state.canCancel).toBe(true);
  });
});
