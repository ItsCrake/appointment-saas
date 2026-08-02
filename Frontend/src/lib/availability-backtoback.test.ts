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
      // Deliberately a value the engine no longer steps by: the grid is the
      // service's own block. If this ever leaks back into the output, these
      // tests produce :15 boundaries and fail loudly.
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
  new Date(new Date(`${DATE}T${hhmm}:00+03:00`).toISOString()); // IDT in September

describe("grid steps by duration + buffer", () => {
  it("15-minute service with a 5-minute buffer steps by 20", () => {
    const slots = computeSlots(input({ durationMin: 15, serviceBufferMin: 5 }));

    expect(labels(slots).slice(0, 6)).toEqual([
      "09:00",
      "09:20",
      "09:40",
      "10:00",
      "10:20",
      "10:40",
    ]);
  });

  it("20-minute service with no buffer steps by 20", () => {
    const slots = computeSlots(input({ durationMin: 20, serviceBufferMin: 0 }));

    expect(labels(slots).slice(0, 6)).toEqual([
      "09:00",
      "09:20",
      "09:40",
      "10:00",
      "10:20",
      "10:40",
    ]);
  });

  it("35-minute service with no buffer steps by 35", () => {
    const slots = computeSlots(input({ durationMin: 35, serviceBufferMin: 0 }));

    expect(labels(slots).slice(0, 4)).toEqual([
      "09:00",
      "09:35",
      "10:10",
      "10:45",
    ]);
  });

  it("inherits the business buffer into the step when the service is null", () => {
    const slots = computeSlots(
      input({
        durationMin: 25,
        serviceBufferMin: null,
        business: {
          timezone: TZ,
          slotIntervalMin: 15,
          bufferMin: 5,
          minNoticeMin: 0,
          maxAdvanceDays: 365,
        },
      }),
    );

    // 25 + 5 = 30.
    expect(labels(slots).slice(0, 4)).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
  });

  it("never runs a slot past the shift end", () => {
    const slots = computeSlots(
      input({
        durationMin: 35,
        serviceBufferMin: 0,
        shifts: [{ startTime: "09:00", endTime: "10:00", isClosed: false }],
      }),
    );

    // 09:00 and 09:35 fit (09:35 ends 10:10 — it does not).
    expect(labels(slots)).toEqual(["09:00"]);
  });
});

describe("a booking re-anchors the grid", () => {
  it("resumes stepping from the end of the appointment, not the shift start", () => {
    // The originally reported case: 09:15–09:35 booked, 20-minute service.
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    // 09:00 overlaps the booking, so the first offer is the re-anchor, and
    // everything after follows the new line — not 09:40 from the old grid.
    expect(labels(slots).slice(0, 5)).toEqual([
      "09:35",
      "09:55",
      "10:15",
      "10:35",
      "10:55",
    ]);
  });

  it("leaves no sliver between the re-anchor and the next start", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    // The old grid's 09:40 would sit 5 minutes after 09:35 and strand a
    // window too short to book.
    expect(labels(slots)).not.toContain("09:40");
    expect(labels(slots)).not.toContain("10:00");
  });

  it("adds the buffer to the re-anchor point", () => {
    const slots = computeSlots(
      input({
        durationMin: 15,
        serviceBufferMin: 5,
        appointments: [{ startsAt: at("09:20"), endsAt: at("09:40") }],
      }),
    );

    // 09:00 survives: it runs to 09:15 and its 5-minute gap closes exactly at
    // 09:20, the moment the booking opens. The buffer is honoured to the
    // minute rather than requiring slack beyond it.
    //
    // 09:20 then conflicts, so the grid re-anchors to 09:40 + 5 = 09:45 and
    // resumes stepping by 20.
    expect(labels(slots).slice(0, 4)).toEqual([
      "09:00",
      "09:45",
      "10:05",
      "10:25",
    ]);
  });

  it("chains through consecutive appointments", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        appointments: [
          { startsAt: at("09:15"), endsAt: at("09:35") },
          { startsAt: at("09:35"), endsAt: at("09:55") },
        ],
      }),
    );

    expect(labels(slots).slice(0, 3)).toEqual(["09:55", "10:15", "10:35"]);
    expect(labels(slots)).not.toContain("09:35");
  });

  it("still refuses any start that would overlap a booking", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        appointments: [{ startsAt: at("09:15"), endsAt: at("09:35") }],
      }),
    );

    for (const blocked of ["09:00", "09:15", "09:20", "09:30"]) {
      expect(labels(slots)).not.toContain(blocked);
    }
  });

  it("emits nothing when the gap before a booking is shorter than the service", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        // Only 10 minutes between the shift opening and the booking.
        appointments: [{ startsAt: at("09:10"), endsAt: at("09:30") }],
      }),
    );

    // No orphan candidate in the unusable 09:00–09:10 window.
    expect(labels(slots)[0]).toBe("09:30");
  });

  it("re-anchors past a closure as well", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        timeOff: [{ startsAt: at("09:00"), endsAt: at("09:50") }],
      }),
    );

    expect(labels(slots).slice(0, 3)).toEqual(["09:50", "10:10", "10:30"]);
  });

  it("honours minimum notice without stopping the walk", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        now: at("09:00"),
        business: {
          timezone: TZ,
          slotIntervalMin: 15,
          bufferMin: 0,
          minNoticeMin: 60,
          maxAdvanceDays: 365,
        },
      }),
    );

    // Everything before 10:00 is inside the notice window; the grid itself is
    // unchanged, so the first offer is a normal step point.
    expect(labels(slots)[0]).toBe("10:00");
    expect(labels(slots)).not.toContain("09:40");
  });

  it("keeps each shift of a split day on its own line", () => {
    const slots = computeSlots(
      input({
        durationMin: 20,
        serviceBufferMin: 0,
        shifts: [
          { startTime: "09:00", endTime: "10:00", isClosed: false },
          { startTime: "14:00", endTime: "15:00", isClosed: false },
        ],
      }),
    );

    expect(labels(slots)).toEqual([
      "09:00",
      "09:20",
      "09:40",
      "14:00",
      "14:20",
      "14:40",
    ]);
  });

  it("returns nothing for a service with no duration", () => {
    expect(computeSlots(input({ durationMin: 0 }))).toEqual([]);
  });
});
