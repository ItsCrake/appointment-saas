import { describe, expect, it } from "vitest";

import {
  previousStep,
  stepAfterSlot,
  type BookingStep,
} from "@/lib/booking-steps";

const SOLO = { multiStaff: false, freeStaffCount: 1 };
const TEAM_ONE_FREE = { multiStaff: true, freeStaffCount: 1 };
const TEAM_MANY_FREE = { multiStaff: true, freeStaffCount: 3 };

const ALL_STEPS: BookingStep[] = [1, 2, "staff", "only", 3];

describe("stepAfterSlot", () => {
  it("sends a single-staff shop straight to the details form", () => {
    // Silently, and that is the point of the binary setup question: a client of
    // a one-chair shop never learns the concept exists.
    expect(stepAfterSlot(SOLO)).toBe(3);
    expect(stepAfterSlot({ multiStaff: false, freeStaffCount: 4 })).toBe(3);
  });

  it("asks a team shop who, even when only one person is free", () => {
    // Being quietly assigned somebody is the failure worth avoiding: the client
    // came to a shop with several barbers and cannot tell they were given the
    // only one left, or that another time would have offered a choice.
    expect(stepAfterSlot(TEAM_ONE_FREE)).toBe("only");
    expect(stepAfterSlot(TEAM_MANY_FREE)).toBe("staff");
  });
});

describe("previousStep", () => {
  it("has no back on the first step", () => {
    expect(previousStep(1, { ...SOLO, hasSlot: false })).toBeNull();
  });

  it("returns from the details form to the grid in a single-staff shop", () => {
    // The bug this module was extracted for. `stepAfterSlot` answers 3 here, so
    // reusing it made back-from-3 return 3 — a dead button on the last step for
    // most tenants.
    expect(previousStep(3, { ...SOLO, hasSlot: true })).toBe(2);
  });

  it("returns from the details form to whichever question was asked", () => {
    expect(previousStep(3, { ...TEAM_MANY_FREE, hasSlot: true })).toBe("staff");
    expect(previousStep(3, { ...TEAM_ONE_FREE, hasSlot: true })).toBe("only");
  });

  it("falls back to the grid when there is no slot to reason about", () => {
    expect(previousStep(3, { ...TEAM_MANY_FREE, hasSlot: false })).toBe(2);
  });

  it("returns from either staff question to the grid", () => {
    expect(previousStep("staff", { ...TEAM_MANY_FREE, hasSlot: true })).toBe(2);
    expect(previousStep("only", { ...TEAM_ONE_FREE, hasSlot: true })).toBe(2);
  });

  it("returns from the grid to the service list", () => {
    expect(previousStep(2, { ...SOLO, hasSlot: false })).toBe(1);
  });

  it("never returns the step it was given, in any configuration", () => {
    // The property that failing would reproduce the original bug: a back button
    // that lands where it started is indistinguishable from a dead one.
    for (const context of [SOLO, TEAM_ONE_FREE, TEAM_MANY_FREE]) {
      for (const hasSlot of [true, false]) {
        for (const step of ALL_STEPS) {
          const destination = previousStep(step, { ...context, hasSlot });
          expect(destination).not.toBe(step);
        }
      }
    }
  });

  it("always walks towards the start, never past it", () => {
    // Every destination is a real, earlier step — never `3`, which would be
    // forwards, and never a value the flow cannot render.
    for (const context of [SOLO, TEAM_ONE_FREE, TEAM_MANY_FREE]) {
      for (const step of ALL_STEPS) {
        const destination = previousStep(step, { ...context, hasSlot: true });
        if (destination === null) continue;
        expect(ALL_STEPS).toContain(destination);
        expect(destination).not.toBe(3);
      }
    }
  });
});
