import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  LOAD_TEST_PHONE_PREFIX,
  planLoadTest,
  type LoadTestInput,
  type LoadTestRow,
} from "@/db/load-test-plan";

/**
 * The load test's planner, checked against the shop it was written for.
 *
 * ---------------------------------------------------------------------------
 * Three of these are what running it against production depends on. **Overlap**
 * would fail the insert outright — `appointments_no_overlap_staff` rejects the
 * row and takes the whole transaction with it. **Posted hours** is what makes
 * the calendar read as a day rather than as a script's output. **No bookable
 * hole** is the claim the run reports — "fully booked" — so it is measured here
 * from the rows, independently of how the planner decided to place them.
 * ---------------------------------------------------------------------------
 */

const TZ = "Asia/Jerusalem";
/** Tuesday 19:54 in the shop: after closing, so Sunday to Tuesday are behind the clock. */
const NOW = new Date("2026-09-15T16:54:00Z");
const MINUTE = 60_000;

const DAYS = Array.from({ length: 14 }, (_, i) =>
  new Date(Date.parse("2026-09-13T00:00:00Z") + i * 86_400_000)
    .toISOString()
    .slice(0, 10),
);

/** demo-barber's five services, as they are in production. */
// prettier-ignore
const SERVICES = [
  { id: "cut", name: "תספורת גבר", durationMin: 30, priceCents: 7000, weight: 5, forChild: false },
  { id: "kid", name: "תספורת ילד", durationMin: 20, priceCents: 6000, weight: 2, forChild: true },
  { id: "beard", name: "עיצוב זקן", durationMin: 15, priceCents: 3000, weight: 2, forChild: false },
  { id: "both", name: "תספורת + זקן", durationMin: 45, priceCents: 9000, weight: 3.5, forChild: false },
  { id: "colour", name: "צבע", durationMin: 60, priceCents: 14000, weight: 1.2, forChild: false },
];
const SHORTEST = 15;

/** Sunday–Thursday with a lunch hour, a short Friday, Saturday closed. */
const HOURS = (_staffId: string, weekday: number) =>
  weekday === 6
    ? []
    : weekday === 5
      ? [{ from: 540, to: 840 }]
      : [
          { from: 540, to: 780 },
          { from: 840, to: 1140 },
        ];

const local = (day: string, time: string) =>
  fromZonedTime(`${day}T${time}:00`, TZ);

/** Sunday already half booked, one booking at an odd minute, and a closure on Thursday. */
const OCCUPIED = [
  {
    staffId: "nir",
    startsAt: local("2026-09-13", "09:00"),
    endsAt: local("2026-09-13", "09:20"),
  },
  {
    staffId: "nir",
    startsAt: local("2026-09-13", "09:25"),
    endsAt: local("2026-09-13", "09:45"),
  },
  {
    staffId: "nir",
    startsAt: local("2026-09-13", "11:05"),
    endsAt: local("2026-09-13", "11:23"),
  },
  {
    staffId: null,
    startsAt: local("2026-09-17", "15:00"),
    endsAt: local("2026-09-17", "16:30"),
  },
];

function input(overrides: Partial<LoadTestInput> = {}): LoadTestInput {
  return {
    timezone: TZ,
    days: DAYS,
    staffIds: ["nir"],
    windowsFor: HOURS,
    services: SERVICES,
    occupied: OCCUPIED,
    bufferMin: 5,
    now: NOW,
    seed: 20260915,
    ...overrides,
  };
}

type Span = { start: number; end: number; row?: LoadTestRow };

/** Every open window with what fills it — existing time and planned live rows — in order. */
function windowsOf(given: LoadTestInput, rows: LoadTestRow[]) {
  const out: {
    day: string;
    staffId: string;
    open: number;
    close: number;
    spans: Span[];
  }[] = [];

  for (const staffId of given.staffIds) {
    for (const day of given.days) {
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      for (const w of given.windowsFor(staffId, weekday)) {
        const open = local(
          day,
          `${String(w.from / 60).padStart(2, "0")}:00`,
        ).getTime();
        const close = local(
          day,
          `${String(w.to / 60).padStart(2, "0")}:00`,
        ).getTime();
        const inside = (start: number, end: number) =>
          start < close && end > open;

        const spans: Span[] = [
          ...given.occupied
            .filter((o) => o.staffId === null || o.staffId === staffId)
            .map((o) => ({
              start: o.startsAt.getTime(),
              end: o.endsAt.getTime(),
            })),
          ...rows
            .filter((r) => r.staffId === staffId && r.status !== "cancelled")
            .map((r) => ({
              start: r.startsAt.getTime(),
              end: r.endsAt.getTime(),
              row: r,
            })),
        ]
          .filter((span) => inside(span.start, span.end))
          .sort((a, b) => a.start - b.start);

        out.push({ day, staffId, open, close, spans });
      }
    }
  }

  return out;
}

describe("a fortnight booked solid", () => {
  it("never puts two live bookings on one chair at once, whatever the seed", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const given = input({ seed });
      for (const window of windowsOf(given, planLoadTest(given))) {
        for (let i = 1; i < window.spans.length; i++) {
          expect(window.spans[i].start).toBeGreaterThanOrEqual(
            window.spans[i - 1].end,
          );
        }
      }
    }
  });

  it("keeps every row inside posted hours, and Saturday empty, whatever the seed", () => {
    const minutes = (instant: Date) => {
      const [h, m] = formatInTimeZone(instant, TZ, "HH:mm")
        .split(":")
        .map(Number);
      return h * 60 + m;
    };

    // Cancelled rows included: a longer booking that was given up still has to
    // have fitted the day it was made for.
    for (let seed = 1; seed <= 25; seed++) {
      for (const row of planLoadTest(input({ seed }))) {
        const day = formatInTimeZone(row.startsAt, TZ, "yyyy-MM-dd");
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();

        expect(weekday).not.toBe(6);
        const within = HOURS("nir", weekday).some(
          (w) => minutes(row.startsAt) >= w.from && minutes(row.endsAt) <= w.to,
        );
        expect(within, `${row.status} ${row.startsAt.toISOString()}`).toBe(
          true,
        );
      }
    }
  });

  it("leaves no hole any service could be booked into, across every seed", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const given = input({ seed });
      let widest = 0;

      for (const window of windowsOf(given, planLoadTest(given))) {
        let cursor = window.open;
        for (const span of window.spans) {
          widest = Math.max(widest, span.start - cursor);
          cursor = Math.max(cursor, span.end);
        }
        widest = Math.max(widest, window.close - cursor);
      }

      expect(widest / MINUTE).toBeLessThan(SHORTEST);
    }
  });

  it("books around what is already there, including the closure", () => {
    const given = input();
    const rows = planLoadTest(given);
    const live = rows.filter((row) => row.status !== "cancelled");
    const closure = OCCUPIED[3];

    expect(
      live.some(
        (row) => row.startsAt < closure.endsAt && row.endsAt > closure.startsAt,
      ),
    ).toBe(false);
    // Every open day in the fortnight got something.
    const days = new Set(
      live.map((row) => formatInTimeZone(row.startsAt, TZ, "yyyy-MM-dd")),
    );
    expect(DAYS.filter((day) => !days.has(day))).toEqual([
      "2026-09-19",
      "2026-09-26",
    ]);
  });

  it("packs bookings back to back and five or ten minutes apart", () => {
    const given = input();
    const gaps = new Set<number>();

    for (const window of windowsOf(given, planLoadTest(given))) {
      for (let i = 1; i < window.spans.length; i++) {
        if (window.spans[i].row && window.spans[i - 1].row) {
          gaps.add((window.spans[i].start - window.spans[i - 1].end) / MINUTE);
        }
      }
    }

    expect([...gaps].sort((a, b) => a - b)).toEqual([0, 5, 10]);
  });

  it("tags every row with the batch prefix, one person per number", () => {
    const rows = planLoadTest(input());
    const names = new Map<string, string>();

    for (const row of rows) {
      expect(row.clientPhone).toMatch(
        new RegExp(`^${LOAD_TEST_PHONE_PREFIX}\\d{6}$`),
      );
      expect(names.get(row.clientPhone) ?? row.clientName).toBe(row.clientName);
      names.set(row.clientPhone, row.clientName);
    }
    // Regulars and siblings share a number; most clients do not.
    expect(names.size).toBeGreaterThan(rows.length * 0.7);
    expect(names.size).toBeLessThan(rows.length);
  });

  it("gives statuses a diary could have", () => {
    const rows = planLoadTest(input());

    for (const row of rows) {
      if (row.status === "pending") {
        expect(row.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
        expect(row.createdVia).toBe("online");
      }
      if (row.endsAt <= NOW) expect(row.status).not.toBe("pending");
    }

    const count = (status: LoadTestRow["status"]) =>
      rows.filter((row) => row.status === status).length;
    expect(count("pending")).toBeGreaterThan(0);
    expect(count("cancelled")).toBeGreaterThan(0);
    expect(count("confirmed")).toBeGreaterThan(
      count("pending") + count("cancelled"),
    );
  });

  it("puts every cancellation under the booking that took its slot, and before it in time", () => {
    const rows = planLoadTest(input());
    const liveAt = new Map(
      rows
        .filter((row) => row.status !== "cancelled")
        .map((row) => [`${row.staffId}|${row.startsAt.getTime()}`, row]),
    );

    for (const row of rows) {
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(row.createdAt.getTime()).toBeLessThan(row.startsAt.getTime());

      if (row.status !== "cancelled") {
        expect(row.cancelledAt).toBeNull();
        continue;
      }

      const replacement = liveAt.get(
        `${row.staffId}|${row.startsAt.getTime()}`,
      );
      expect(replacement).toBeDefined();
      expect(row.cancelledAt!.getTime()).toBeGreaterThanOrEqual(
        row.createdAt.getTime(),
      );
      expect(row.cancelledAt!.getTime()).toBeLessThanOrEqual(
        replacement!.createdAt.getTime(),
      );
    }
  });

  it("never credits the booking page with a booking squeezed against a neighbour", () => {
    const given = input();

    for (const window of windowsOf(given, planLoadTest(given))) {
      window.spans.forEach((span, i) => {
        if (!span.row) return;
        const before = i > 0 ? span.start - window.spans[i - 1].end : Infinity;
        const after =
          i < window.spans.length - 1
            ? window.spans[i + 1].start - span.end
            : Infinity;
        if (Math.min(before, after) < given.bufferMin * MINUTE) {
          expect(span.row.createdVia).not.toBe("online");
        }
      });
    }
  });

  it("plans the same fortnight from the same seed", () => {
    expect(planLoadTest(input())).toEqual(planLoadTest(input()));
    expect(planLoadTest(input({ seed: 7 }))).not.toEqual(planLoadTest(input()));
  });

  it("fills each chair of a team on its own, so their cards share the day", () => {
    const given = input({ staffIds: ["nir", "dana"], occupied: [] });
    const rows = planLoadTest(given);

    for (const window of windowsOf(given, rows)) {
      for (let i = 1; i < window.spans.length; i++) {
        expect(window.spans[i].start).toBeGreaterThanOrEqual(
          window.spans[i - 1].end,
        );
      }
    }

    const nir = rows.filter(
      (row) => row.staffId === "nir" && row.status !== "cancelled",
    );
    const dana = rows.filter(
      (row) => row.staffId === "dana" && row.status !== "cancelled",
    );
    expect(
      nir.some((a) =>
        dana.some((b) => a.startsAt < b.endsAt && b.startsAt < a.endsAt),
      ),
    ).toBe(true);
  });
});
