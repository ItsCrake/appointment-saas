import { describe, expect, it } from "vitest";

import {
  DEMO_FUTURE_DAYS,
  DEMO_PAST_DAYS,
  generateDemoAppointments,
  makeFreedSlot,
  makeRandom,
  type GenerateInput,
} from "@/db/demo-data";

/**
 * The demo calendar, checked for the things a screenshot would expose.
 *
 * Two of these are load-bearing beyond appearances. **Overlap** would make the
 * seed fail outright — `appointments_no_overlap_staff` rejects the insert and
 * takes the transaction with it — and running the real seed to find that out
 * costs a live demo tenant. **Future availability** is what the E2E suite books
 * into; a generator that filled the week would break a suite nobody would
 * connect back to a seed change.
 */

const TZ = "Asia/Jerusalem";
/** A Tuesday, so the week either side covers both shift shapes. */
const NOW = new Date("2026-08-04T09:00:00Z");

const SERVICES = [
  { id: "svc-1", name: "תספורת גבר", durationMin: 30, priceCents: 7000 },
  { id: "svc-2", name: "עיצוב זקן", durationMin: 15, priceCents: 3000 },
  { id: "svc-3", name: "צבע", durationMin: 60, priceCents: 14000 },
];

const CLIENTS = [
  { name: "עומר לוי", phone: "0521100201" },
  { name: "דניאל כהן", phone: "0521100202" },
  { name: "איתי מזרחי", phone: "0521100203" },
];

function generate(overrides: Partial<GenerateInput> = {}) {
  return generateDemoAppointments({
    businessId: "11111111-2222-3333-4444-555555555555",
    timezone: TZ,
    services: SERVICES,
    staffIds: ["staff-a", "staff-b"],
    shiftsForWeekday: (weekday) => {
      if (weekday === 6) return [];
      if (weekday === 5) return [{ start: "09:00:00", end: "14:00:00" }];
      return [
        { start: "09:00:00", end: "13:00:00" },
        { start: "14:00:00", end: "19:00:00" },
      ];
    },
    clients: CLIENTS,
    bufferMin: 5,
    now: NOW,
    seed: 20260818,
    notes: ["בלי מכונה בבקשה"],
    requiresApproval: true,
    ...overrides,
  });
}

describe("makeRandom", () => {
  it("gives the same sequence for the same seed", () => {
    // The whole reason it exists: a re-seed to fix a typo must not reshuffle
    // every appointment behind the screenshot that was already taken.
    const a = makeRandom(42);
    const b = makeRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("gives different sequences for different seeds", () => {
    // Otherwise both demos come out as one calendar with different names.
    const a = makeRandom(1);
    const b = makeRandom(2);
    expect(a()).not.toBe(b());
  });

  it("stays inside [0, 1)", () => {
    const random = makeRandom(7);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("generateDemoAppointments", () => {
  it("never double-books a provider", () => {
    /**
     * The one that would take the seed down rather than merely look wrong:
     * `appointments_no_overlap_staff` refuses an overlapping insert, and the
     * whole tenant is written in one transaction.
     */
    const rows = generate();
    const byStaff = new Map<string, { start: number; end: number }[]>();

    for (const row of rows) {
      const list = byStaff.get(row.staffId) ?? [];
      list.push({
        start: row.startsAt.getTime(),
        end: row.endsAt.getTime(),
      });
      byStaff.set(row.staffId, list);
    }

    for (const spans of byStaff.values()) {
      const ordered = spans.sort((a, b) => a.start - b.start);
      for (let i = 1; i < ordered.length; i += 1) {
        expect(ordered[i].start).toBeGreaterThanOrEqual(ordered[i - 1].end);
      }
    }
  });

  it("leaves the week ahead genuinely bookable", () => {
    // The E2E suite books a real appointment against the barber demo, and a
    // prospect opening the link has to find a slot.
    const rows = generate();
    const ahead = rows.filter((row) => row.startsAt > NOW);

    // Two providers over roughly six open days: a full diary would be far more
    // than this. The cap is what proves the gaps are real.
    expect(ahead.length).toBeGreaterThan(0);
    expect(ahead.length).toBeLessThan(90);
  });

  it("covers the month behind and the week ahead", () => {
    const rows = generate();
    const earliest = Math.min(...rows.map((row) => row.startsAt.getTime()));
    const latest = Math.max(...rows.map((row) => row.startsAt.getTime()));

    expect(NOW.getTime() - earliest).toBeGreaterThan(
      (DEMO_PAST_DAYS - 3) * 86_400_000,
    );
    expect(latest - NOW.getTime()).toBeGreaterThan(
      (DEMO_FUTURE_DAYS - 3) * 86_400_000,
    );
  });

  it("never books on a closed day", () => {
    // Saturday returns no shifts, and a booking there would contradict the
    // working hours the same seed writes.
    const rows = generate();
    const saturdays = rows.filter(
      (row) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: TZ,
          weekday: "short",
        }).format(row.startsAt) === "Sat",
    );

    expect(saturdays).toEqual([]);
  });

  it("keeps every booking inside a shift", () => {
    const rows = generate();
    for (const row of rows) {
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: TZ,
          hour: "2-digit",
          hour12: false,
        }).format(row.startsAt),
      );
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(19);
    }
  });

  it("never generates pending for a shop that does not take requests", () => {
    /**
     * The alignment that matters: with approval off, `createBookingAction`
     * writes `confirmed` directly, so a pending row is a state the product
     * cannot produce. A demo carrying one is a screenshot of something that
     * does not happen — and it lights the calendar's amber badge for a shop
     * with nothing to approve.
     */
    const rows = generate({ requiresApproval: false });
    expect(rows.filter((row) => row.status === "pending")).toEqual([]);

    // The rest of the mix survives — this removes a status, not the variety.
    const statuses = new Set(rows.map((row) => row.status));
    for (const status of ["confirmed", "completed", "cancelled"]) {
      expect(statuses).toContain(status);
    }
  });

  it("mixes the statuses the way a real calendar does", () => {
    const rows = generate();
    const statuses = new Set(rows.map((row) => row.status));

    // All four the brief asks for, and each actually present rather than
    // theoretically reachable.
    for (const status of ["confirmed", "completed", "pending", "cancelled"]) {
      expect(statuses).toContain(status);
    }

    // History is mostly done; the future cannot be.
    const past = rows.filter((row) => row.startsAt < NOW);
    const completed = past.filter((row) => row.status === "completed");
    expect(completed.length / past.length).toBeGreaterThan(0.6);

    expect(
      rows.filter((row) => row.startsAt > NOW && row.status === "completed"),
    ).toEqual([]);
  });

  it("stamps cancelled rows so the freed-slot banner can find them", () => {
    const rows = generate();
    for (const row of rows) {
      if (row.status === "cancelled") expect(row.cancelledAt).not.toBeNull();
      else expect(row.cancelledAt).toBeNull();
    }
  });

  it("only ever uses the client list it was given", () => {
    // What keeps a barbershop's list male and a nail studio's female: the
    // generator invents nobody.
    const rows = generate();
    const allowed = new Set(CLIENTS.map((client) => client.name));

    for (const row of rows) expect(allowed).toContain(row.clientName);
  });

  it("gives every booking a unique cancel token", () => {
    const rows = generate();
    const tokens = new Set(rows.map((row) => row.cancelToken));
    expect(tokens.size).toBe(rows.length);
  });

  it("reproduces exactly for the same seed, and differs for another", () => {
    const a = generate();
    const b = generate();
    const c = generate({ seed: 99 });

    expect(a.map((row) => row.startsAt.toISOString())).toEqual(
      b.map((row) => row.startsAt.toISOString()),
    );
    expect(a.length).not.toBe(c.length);
  });

  it("copes with a shop that never opens", () => {
    expect(generate({ shiftsForWeekday: () => [] })).toEqual([]);
  });
});

describe("makeFreedSlot", () => {
  it("is a recent cancellation on a day still ahead", () => {
    const freed = makeFreedSlot({
      businessId: "11111111-2222-3333-4444-555555555555",
      timezone: TZ,
      service: SERVICES[0],
      staffId: "staff-a",
      client: CLIENTS[0],
      now: NOW,
    });

    expect(freed.status).toBe("cancelled");
    expect(freed.startsAt.getTime()).toBeGreaterThan(NOW.getTime());
    // Within the banner's one-week window, or it would never be announced.
    expect(freed.cancelledAt).not.toBeNull();
    expect(NOW.getTime() - (freed.cancelledAt?.getTime() ?? 0)).toBeLessThan(
      7 * 86_400_000,
    );
  });

  it("sits clear of everything the generator places", () => {
    // Both land on the same providers, and an overlap here would fail the
    // insert exactly as one inside the generator would.
    const rows = generate();
    const freed = makeFreedSlot({
      businessId: "11111111-2222-3333-4444-555555555555",
      timezone: TZ,
      service: SERVICES[0],
      staffId: "staff-a",
      client: CLIENTS[0],
      now: NOW,
    });

    const clash = rows.some(
      (row) =>
        row.staffId === freed.staffId &&
        row.startsAt < freed.endsAt &&
        row.endsAt > freed.startsAt,
    );

    expect(clash).toBe(false);
  });
});
