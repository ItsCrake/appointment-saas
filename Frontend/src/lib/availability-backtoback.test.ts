import { describe, expect, it } from "vitest";

import { computeSlots, type ComputeSlotsInput } from "@/lib/availability";

const TZ = "Asia/Jerusalem";
const DATE = "2026-09-07"; // a Monday, comfortably outside any DST edge

/** Well before the shift, so `minNoticeMin` never censors the morning. */
const NOW = new Date("2026-09-06T12:00:00Z");

function input(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    business: {
      timezone: TZ,
      slotIntervalMin: 15,
      bufferMin: 0,
      minNoticeMin: 0,
      maxAdvanceDays: 365,
    },
    durationMin: 20,
    serviceBufferMin: null,
    shifts: [{ startTime: "09:00", endTime: "12:00", isClosed: false }],
    appointments: [],
    timeOff: [],
    date: DATE,
    now: NOW,
    ...overrides,
  };
}

/** "HH:mm" in the business timezone — what the client actually sees. */
const labels = (slots: { label: string }[]) => slots.map((s) => s.label);

/** Local wall-clock helper, so the tests read in shop time not UTC. */
const at = (hhmm: string) =>
  new Date(
    new Date(`${DATE}T${hhmm}:00+03:00`).toISOString(), // IDT in September
  );

describe("back-to-back slots for a 20-minute service with no buffer", () => {
  it("offers the exact end of an existing appointment as the next start", () => {
    // The reported case: 09:15–09:35 booked, 20-minute service, zero buffer.
    // 09:35 is a legal start but is not on the 15-minute grid, so it used to
    // be skipped entirely and the next offer jumped to 09:45.
    const slots = computeSlots(
      input({
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    expect(labels(slots)).toContain("09:35");
  });

  it("does not lose the ten minutes after each appointment", () => {
    const slots = computeSlots(
      input({
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    // 09:00 fits (ends 09:20)? No — it overlaps the 09:15 booking. The first
    // offer is therefore the back-to-back one.
    expect(labels(slots).slice(0, 3)).toEqual(["09:35", "09:45", "10:00"]);
  });

  it("still refuses a start that would overlap the appointment", () => {
    const slots = computeSlots(
      input({
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    // 09:30 + 20min runs to 09:50, straight through the booking.
    expect(labels(slots)).not.toContain("09:30");
    expect(labels(slots)).not.toContain("09:15");
    expect(labels(slots)).not.toContain("09:00");
  });

  it("chains back-to-back through consecutive appointments", () => {
    const slots = computeSlots(
      input({
        appointments: [
          { startsAt: at("09:15"), endsAt: at("09:35") },
          { startsAt: at("09:35"), endsAt: at("09:55") },
        ],
      }),
    );

    expect(labels(slots)).toContain("09:55");
    expect(labels(slots)).not.toContain("09:35");
  });

  it("respects a non-zero buffer when placing the back-to-back start", () => {
    const slots = computeSlots(
      input({
        serviceBufferMin: 10,
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    // Earliest legal start is 09:45, not 09:35 — the gap still holds.
    expect(labels(slots)).not.toContain("09:35");
    expect(labels(slots)).toContain("09:45");
  });

  it("never offers a back-to-back start that runs past the shift end", () => {
    const slots = computeSlots(
      input({
        shifts: [{ startTime: "09:00", endTime: "10:00", isClosed: false }],
        appointments: [{ startsAt: at("09:20"), endsAt: at("09:45") }],
      }),
    );

    // 09:45 + 20min = 10:05, past close. Nothing may be offered after it.
    expect(labels(slots)).not.toContain("09:45");
    expect(slots.every((s) => new Date(s.endsAt) <= at("10:00"))).toBe(true);
  });

  it("does not duplicate a start that the grid already produced", () => {
    const slots = computeSlots(
      input({
        // Ends exactly on a grid point, so both sources propose 09:30.
        appointments: [{ startsAt: at("09:10"), endsAt: at("09:30") }],
      }),
    );

    expect(labels(slots).filter((l) => l === "09:30")).toHaveLength(1);
  });

  it("leaves an empty day on the plain grid", () => {
    const slots = computeSlots(input());

    // No appointments means no extra candidates — the grid is unchanged.
    expect(labels(slots).slice(0, 4)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
    ]);
  });

  it("keeps back-to-back starts inside time off", () => {
    const slots = computeSlots(
      input({
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
        timeOff: [{ startsAt: at("09:35"), endsAt: at("10:30") }],
      }),
    );

    // The slot is legal against the appointment but lands inside a closure.
    expect(labels(slots)).not.toContain("09:35");
  });

  it("honours minimum notice on a back-to-back start", () => {
    const slots = computeSlots(
      input({
        // 09:30 local on the day itself; 09:35 is inside the notice window.
        now: at("09:00"),
        business: {
          timezone: TZ,
          slotIntervalMin: 15,
          bufferMin: 0,
          minNoticeMin: 60,
          maxAdvanceDays: 365,
        },
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    expect(labels(slots)).not.toContain("09:35");
  });
});
