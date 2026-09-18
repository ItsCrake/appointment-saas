import { describe, expect, it } from "vitest";

import { TERMINAL_STATUSES } from "@/db/schema";

import {
  canMove,
  dropConflict,
  dropStart,
  minutesAt,
  movedEntry,
  SETTLED_STATUSES,
  snapToGrid,
  timeToMinutes,
  type EditableEntry,
} from "./calendar-edit";

/**
 * The full calendar's edit mode, on integers.
 *
 * Drag and swap are pointer work in `WeekCalendar`; what they decide is here —
 * where a card lands, whether it may, and what it looks like while the server
 * is asked — so the rules are pinned without a browser.
 */

const at = (hours: number, minutes = 0) => hours * 60 + minutes;
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function booking(
  id: string,
  start: number,
  end: number,
  overrides: Partial<EditableEntry> = {},
): EditableEntry {
  return {
    id: `${id}:${overrides.dayIndex ?? 1}`,
    appointmentId: id,
    kind: "appointment",
    status: "confirmed",
    staffId: "maya",
    title: `לקוח ${id}`,
    dayIndex: 1,
    date: "2026-09-14",
    startMinutes: start,
    endMinutes: end,
    startTime: hhmm(start),
    endTime: hhmm(end),
    ...overrides,
  };
}

function block(
  id: string,
  start: number,
  end: number,
  staffId: string | null,
): EditableEntry {
  return {
    id: `${id}:1`,
    appointmentId: null,
    kind: "block",
    status: null,
    staffId,
    title: "הפסקה",
    dayIndex: 1,
    date: "2026-09-14",
    startMinutes: start,
    endMinutes: end,
    startTime: hhmm(start),
    endTime: hhmm(end),
  };
}

const OPEN = [{ startMinutes: at(9), endMinutes: at(19) }];
const BOUNDS = { startHour: 8, endHour: 20 };

describe("snapToGrid", () => {
  it("rounds to the nearest five minutes", () => {
    expect(snapToGrid(at(10, 2))).toBe(at(10));
    expect(snapToGrid(at(10, 3))).toBe(at(10, 5));
    expect(snapToGrid(at(10, 7.4))).toBe(at(10, 5));
    expect(snapToGrid(at(10, 58))).toBe(at(11));
  });
});

describe("minutesAt", () => {
  it("reads the wall clock off the column's own height", () => {
    // Twelve hours drawn in 600px: 50px an hour, whatever the density.
    expect(minutesAt(0, 600, BOUNDS)).toBe(at(8));
    expect(minutesAt(125, 600, BOUNDS)).toBe(at(10, 30));
    expect(minutesAt(600, 600, BOUNDS)).toBe(at(20));
  });

  it("does not divide by a column that has not been drawn", () => {
    expect(minutesAt(40, 0, BOUNDS)).toBe(at(8));
  });
});

describe("dropStart", () => {
  it("keeps the card under the pointer where it was picked up", () => {
    // Grabbed ten minutes into the card: the pointer at 11:12 means a start
    // at 11:02, which snaps to 11:00 — not a card whose top leaps to 11:12.
    expect(
      dropStart({
        pointerMinutes: at(11, 12),
        grabOffset: 10,
        duration: 30,
        bounds: BOUNDS,
      }),
    ).toBe(at(11));
  });

  it("lands only on five-minute marks", () => {
    for (let pointer = at(9); pointer < at(10); pointer += 1.7) {
      const start = dropStart({
        pointerMinutes: pointer,
        grabOffset: 0,
        duration: 25,
        bounds: BOUNDS,
      });
      expect(start % 5).toBe(0);
    }
  });

  it("stays inside the hours drawn", () => {
    expect(
      dropStart({ pointerMinutes: at(6), grabOffset: 0, duration: 30, bounds: BOUNDS }),
    ).toBe(at(8));
    // Ends at the last line, not past it.
    expect(
      dropStart({ pointerMinutes: at(23), grabOffset: 0, duration: 45, bounds: BOUNDS }),
    ).toBe(at(19, 15));
  });

  it("keeps an odd-length booking's latest start on the grid", () => {
    // 32 minutes before 20:00 is 19:28 — not a five-minute mark, so 19:25.
    expect(
      dropStart({ pointerMinutes: at(23), grabOffset: 0, duration: 32, bounds: BOUNDS }),
    ).toBe(at(19, 25));
  });
});

describe("canMove", () => {
  it("picks up a live booking", () => {
    expect(canMove(booking("a", at(10), at(10, 30)))).toBe(true);
    expect(canMove(booking("a", at(10), at(10, 30), { status: "pending" }))).toBe(
      true,
    );
  });

  it("leaves settled bookings and blocks where they are", () => {
    for (const status of SETTLED_STATUSES) {
      expect(canMove(booking("a", at(10), at(10, 30), { status }))).toBe(false);
    }
    expect(canMove(block("b", at(12), at(13), null))).toBe(false);
  });

  it("leaves half of a booking that crosses midnight to the dialog", () => {
    // 23:00–00:30 is drawn as 23:00–24:00 on its first day.
    expect(
      canMove(
        booking("late", at(23), at(24), { startTime: "23:00", endTime: "00:30" }),
      ),
    ).toBe(false);
  });

  it("mirrors the schema's terminal statuses exactly", () => {
    // A client component cannot import the schema, so the list is restated —
    // and a status added to one and not the other would let the calendar
    // offer a move the action refuses, or hide one it allows.
    expect([...SETTLED_STATUSES].sort()).toEqual([...TERMINAL_STATUSES].sort());
  });
});

describe("dropConflict", () => {
  const moving = {
    appointmentId: "m",
    staffId: "maya",
    dayIndex: 1,
    startMinutes: at(10),
    endMinutes: at(10, 30),
  };

  it("finds nothing in a free, open slot", () => {
    expect(dropConflict([booking("x", at(11), at(12))], moving, OPEN)).toBeNull();
  });

  it("calls a live booking of the same provider a clash", () => {
    expect(
      dropConflict([booking("x", at(10, 15), at(11))], moving, OPEN),
    ).toEqual({ kind: "clash", title: "לקוח x", startMinutes: at(10, 15) });
  });

  it("lets a card end exactly where the next begins", () => {
    expect(
      dropConflict([booking("x", at(10, 30), at(11))], moving, OPEN),
    ).toBeNull();
  });

  it("ignores another provider, another day, the card itself and settled rows", () => {
    const entries = [
      booking("x", at(10), at(11), { staffId: "dana" }),
      booking("y", at(10), at(11), { dayIndex: 2 }),
      booking("m", at(9, 45), at(10, 15)),
      booking("z", at(10), at(11), { status: "cancelled" }),
    ];
    expect(dropConflict(entries, moving, OPEN)).toBeNull();
  });

  it("calls a block over the slot blocked — the shop's or this provider's", () => {
    expect(
      dropConflict([block("b", at(10), at(11), null)], moving, OPEN),
    ).toEqual({ kind: "blocked", title: "הפסקה" });
    expect(
      dropConflict([block("b", at(10), at(11), "maya")], moving, OPEN),
    ).toEqual({ kind: "blocked", title: "הפסקה" });
    expect(
      dropConflict([block("b", at(10), at(11), "dana")], moving, OPEN),
    ).toBeNull();
  });

  it("calls a slot outside the day's hours closed", () => {
    expect(
      dropConflict([], { ...moving, startMinutes: at(8, 45), endMinutes: at(9, 15) }, OPEN),
    ).toEqual({ kind: "closed" });
    expect(dropConflict([], moving, [])).toEqual({ kind: "closed" });
  });

  it("reports the clash first — it is the one no confirmation can waive", () => {
    const entries = [
      block("b", at(10), at(11), null),
      booking("x", at(10), at(10, 30)),
    ];
    expect(
      dropConflict(entries, { ...moving, startMinutes: at(8), endMinutes: at(10, 30) }, OPEN)
        ?.kind,
    ).toBe("clash");
  });
});

describe("movedEntry", () => {
  it("moves the booking and keeps its length", () => {
    const moved = movedEntry(booking("a", at(10), at(10, 45)), {
      appointmentId: "a",
      dayIndex: 3,
      date: "2026-09-16",
      startMinutes: at(14, 5),
    });

    expect(moved).toMatchObject({
      dayIndex: 3,
      date: "2026-09-16",
      startMinutes: at(14, 5),
      endMinutes: at(14, 50),
      startTime: "14:05",
      endTime: "14:50",
    });
  });
});

describe("timeToMinutes", () => {
  it("reads HH:MM", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:05")).toBe(at(9, 5));
    expect(timeToMinutes("23:55")).toBe(at(23, 55));
  });
});
