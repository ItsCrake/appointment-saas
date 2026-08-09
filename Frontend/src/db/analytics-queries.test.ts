import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getBookingTrend,
  getPeakHeatmap,
  getServiceBreakdown,
  getStaffLoad,
  getStatusBreakdown,
} from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
  TZ,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The analytics aggregates against real Postgres.
 *
 * The timezone extraction is why this file exists. "Busiest hour" is a
 * wall-clock question, and reading `starts_at` raw would put a Tel Aviv shop's
 * 09:00 rush at 06:00 in summer and 07:00 in winter — a number that is wrong
 * in a way nobody would ever notice, because it is plausible.
 */

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

const WINDOW = {
  from: new Date("2026-01-01T00:00:00Z"),
  to: new Date("2027-01-01T00:00:00Z"),
};

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

async function shop() {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 60 });
  const [alice] = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.businessId, business.id),
  });
  return { business, service, alice };
}

/** A booking at a given UTC instant. */
async function book(
  businessId: string,
  serviceId: string,
  staffId: string,
  startsAt: string,
  overrides: Parameters<typeof createAppointment>[5] = {},
) {
  const start = new Date(startsAt);
  return createAppointment(
    db,
    businessId,
    serviceId,
    start,
    new Date(start.getTime() + 3_600_000),
    { staffId, ...overrides },
  );
}

describe("getPeakHeatmap", () => {
  it("buckets by the shop's wall clock, not by UTC", async () => {
    // 2026-08-03 is a Monday. 06:00Z is 09:00 in Israel (IDT, UTC+3).
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z");

    const [row] = await getPeakHeatmap(db, business.id, TZ, WINDOW);

    expect(row.hour).toBe(9);
    expect(row.weekday).toBe(1);
    expect(row.bookings).toBe(1);
  });

  it("gives the same wall-clock hour either side of a DST change", async () => {
    // The whole point. Both are 09:00 local; UTC disagrees by an hour.
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z");
    await book(business.id, service.id, alice.id, "2026-12-07T07:00:00Z");

    const rows = await getPeakHeatmap(db, business.id, TZ, WINDOW);

    expect(rows.every((row) => row.hour === 9)).toBe(true);
  });

  it("ignores cancelled bookings", async () => {
    // They occupied no chair. Counting them would inflate exactly the number
    // an owner uses to decide when to open.
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      status: "cancelled",
    });

    expect(await getPeakHeatmap(db, business.id, TZ, WINDOW)).toEqual([]);
  });

  it("returns nothing outside the window", async () => {
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2025-08-03T06:00:00Z");

    expect(await getPeakHeatmap(db, business.id, TZ, WINDOW)).toEqual([]);
  });

  it("does not mix one tenant's bookings into another's", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(
      theirs.business.id,
      theirs.service.id,
      theirs.alice.id,
      "2026-08-03T06:00:00Z",
    );

    expect(await getPeakHeatmap(db, mine.business.id, TZ, WINDOW)).toEqual([]);
  });
});

describe("getServiceBreakdown", () => {
  it("groups by the snapshotted name and sums expected revenue", async () => {
    // Snapshotted, not joined: a renamed or deleted service still has history,
    // and a join would drop those rows or relabel them under a newer name.
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      serviceName: "תספורת",
      priceCents: 8000,
    });
    await book(business.id, service.id, alice.id, "2026-08-04T06:00:00Z", {
      serviceName: "תספורת",
      priceCents: 8000,
    });
    await book(business.id, service.id, alice.id, "2026-08-05T06:00:00Z", {
      serviceName: "זקן",
      priceCents: 5000,
    });

    const rows = await getServiceBreakdown(db, business.id, WINDOW);

    expect(rows[0]).toMatchObject({
      serviceName: "תספורת",
      bookings: 2,
      revenueCents: 16000,
    });
    expect(rows[1]).toMatchObject({ serviceName: "זקן", revenueCents: 5000 });
  });

  it("leaves cancelled revenue out", async () => {
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      priceCents: 8000,
    });
    await book(business.id, service.id, alice.id, "2026-08-04T06:00:00Z", {
      priceCents: 8000,
      status: "cancelled",
    });

    const [row] = await getServiceBreakdown(db, business.id, WINDOW);
    expect(row.revenueCents).toBe(8000);
  });
});

describe("getStatusBreakdown", () => {
  it("is the one place cancellations are counted", async () => {
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      status: "completed",
    });
    await book(business.id, service.id, alice.id, "2026-08-04T06:00:00Z", {
      status: "cancelled",
    });

    const rows = await getStatusBreakdown(db, business.id, WINDOW);
    const byStatus = Object.fromEntries(
      rows.map((row) => [row.status, row.bookings]),
    );

    expect(byStatus.completed).toBe(1);
    expect(byStatus.cancelled).toBe(1);
  });
});

describe("getStaffLoad", () => {
  it("splits bookings and revenue per provider", async () => {
    const { business, service, alice } = await shop();
    const bob = await createStaff(db, business.id, {
      name: "בוב",
      color: "amber",
    });

    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      priceCents: 7000,
    });
    await book(business.id, service.id, alice.id, "2026-08-04T06:00:00Z", {
      priceCents: 7000,
    });
    await book(business.id, service.id, bob.id, "2026-08-05T06:00:00Z", {
      priceCents: 5000,
    });

    const rows = await getStaffLoad(db, business.id, WINDOW);

    expect(rows[0]).toMatchObject({
      staffId: alice.id,
      bookings: 2,
      revenueCents: 14000,
    });
    expect(rows[1]).toMatchObject({
      staffName: "בוב",
      color: "amber",
      bookings: 1,
    });
  });

  it("omits a provider with nothing in the window rather than showing a zero", async () => {
    const { business, service, alice } = await shop();
    await createStaff(db, business.id, { name: "בוב" });
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z");

    const rows = await getStaffLoad(db, business.id, WINDOW);
    expect(rows).toHaveLength(1);
  });
});

describe("getBookingTrend", () => {
  it("starts weeks on Sunday, which is the Israeli week", async () => {
    // Postgres truncates weeks to Monday. Without the shift, Sunday would be
    // filed under the previous week and every bar would be off by a day.
    const { business, service, alice } = await shop();
    // 2026-08-02 is a Sunday; 2026-08-03 is the Monday after it.
    await book(business.id, service.id, alice.id, "2026-08-02T07:00:00Z");
    await book(business.id, service.id, alice.id, "2026-08-03T07:00:00Z");

    const points = await getBookingTrend(db, business.id, TZ, WINDOW, "week");

    expect(points).toHaveLength(1);
    expect(points[0].period).toBe("2026-08-02");
    expect(points[0].bookings).toBe(2);
  });

  it("separates two different weeks", async () => {
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-02T07:00:00Z");
    await book(business.id, service.id, alice.id, "2026-08-09T07:00:00Z");

    const points = await getBookingTrend(db, business.id, TZ, WINDOW, "week");

    expect(points.map((p) => p.period)).toEqual(["2026-08-02", "2026-08-09"]);
  });

  it("buckets by month and sums expected revenue", async () => {
    const { business, service, alice } = await shop();
    await book(business.id, service.id, alice.id, "2026-08-03T06:00:00Z", {
      priceCents: 7000,
    });
    await book(business.id, service.id, alice.id, "2026-08-20T06:00:00Z", {
      priceCents: 3000,
    });
    await book(business.id, service.id, alice.id, "2026-09-01T06:00:00Z", {
      priceCents: 5000,
    });

    const points = await getBookingTrend(db, business.id, TZ, WINDOW, "month");

    expect(points).toEqual([
      { period: "2026-08-01", bookings: 2, revenueCents: 10000 },
      { period: "2026-09-01", bookings: 1, revenueCents: 5000 },
    ]);
  });

  it("returns points in chronological order", async () => {
    const { business, service, alice } = await shop();
    for (const day of ["2026-09-01", "2026-07-01", "2026-08-01"]) {
      await book(business.id, service.id, alice.id, `${day}T06:00:00Z`);
    }

    const points = await getBookingTrend(db, business.id, TZ, WINDOW, "month");
    expect(points.map((p) => p.period)).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });
});
