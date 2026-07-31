import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDashboardStats } from "@/db/queries";
import type { Database } from "@/db/types";
import { getStatsWindows, toPercent } from "@/lib/stats";
import {
  createAppointment,
  createBusiness,
  createService,
  TZ,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

describe("getStatsWindows", () => {
  // 2026-08-05 is a Wednesday. Israel is UTC+3 in August, so a local day
  // starts at 21:00Z the evening before.
  const summerNow = new Date("2026-08-05T12:00:00Z");

  it("anchors today to the business-local day, not the server day", () => {
    const w = getStatsWindows(TZ, summerNow);
    expect(w.todayStart.toISOString()).toBe("2026-08-04T21:00:00.000Z");
    expect(w.todayEnd.toISOString()).toBe("2026-08-05T21:00:00.000Z");
  });

  it("starts the week on Sunday", () => {
    const w = getStatsWindows(TZ, summerNow);
    // Sunday 2026-08-02 local.
    expect(w.weekStart.toISOString()).toBe("2026-08-01T21:00:00.000Z");
    expect(w.weekEnd.toISOString()).toBe("2026-08-08T21:00:00.000Z");
  });

  it("treats a Sunday as the first day of its own week", () => {
    const w = getStatsWindows(TZ, new Date("2026-08-02T12:00:00Z"));
    expect(w.weekStart.toISOString()).toBe("2026-08-01T21:00:00.000Z");
  });

  it("uses the winter offset for a winter date", () => {
    // December: Israel is UTC+2, so the local day starts at 22:00Z.
    const w = getStatsWindows(TZ, new Date("2026-12-09T12:00:00Z"));
    expect(w.todayStart.toISOString()).toBe("2026-12-08T22:00:00.000Z");
    expect(w.todayEnd.toISOString()).toBe("2026-12-09T22:00:00.000Z");
  });

  it("keeps a local day exactly 24 hours outside a DST transition", () => {
    const w = getStatsWindows(TZ, summerNow);
    const hours = (w.todayEnd.getTime() - w.todayStart.getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });

  it("puts an instant just before local midnight in today, not tomorrow", () => {
    // 23:30 local on the 5th = 20:30Z on the 5th.
    const lateEvening = new Date("2026-08-05T20:30:00Z");
    const w = getStatsWindows(TZ, lateEvening);
    expect(lateEvening >= w.todayStart && lateEvening < w.todayEnd).toBe(true);
  });

  it("measures the rates window back from now", () => {
    const w = getStatsWindows(TZ, summerNow, { ratesWindowDays: 30 });
    expect(w.ratesFrom.toISOString()).toBe("2026-07-06T12:00:00.000Z");
    expect(w.now).toBe(summerNow);
  });
});

describe("toPercent", () => {
  it("rounds to whole percent", () => {
    expect(toPercent(1, 3)).toBe(33);
    expect(toPercent(2, 3)).toBe(67);
  });

  it("returns 0 for an empty denominator rather than NaN", () => {
    expect(toPercent(0, 0)).toBe(0);
    expect(toPercent(5, 0)).toBe(0);
  });
});

/**
 * These run on PGlite, which is more forgiving than postgres.js about
 * parameter binding: a raw Date inside a `sql` template passes here but throws
 * at bind time on the real driver. Aggregate SQL is worth a smoke test against
 * Supabase after any change to the `sql` templates below.
 */
describe("getDashboardStats", () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let db: Database;

  // Wednesday 2026-08-05, 12:00 UTC = 15:00 Israel.
  const NOW = new Date("2026-08-05T12:00:00Z");

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

  async function setup() {
    const business = await createBusiness(db);
    const service = await createService(db, business.id);
    return { business, service };
  }

  /** Non-overlapping slots, so the exclusion constraint stays out of the way. */
  function book(
    business: { id: string },
    service: { id: string },
    startsAt: string,
    status?: string,
  ) {
    const start = new Date(startsAt);
    return createAppointment(
      db,
      business.id,
      service.id,
      start,
      new Date(start.getTime() + 30 * 60_000),
      status ? { status: status as "confirmed" } : {},
    );
  }

  it("counts today in the business timezone, not UTC", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW);

    // 00:30 local on the 5th = 21:30Z on the 4th: UTC says yesterday.
    await book(business, service, "2026-08-04T21:30:00Z");
    // 15:00 local on the 5th.
    await book(business, service, "2026-08-05T12:00:00Z");
    // 00:30 local on the 6th = 21:30Z on the 5th: UTC says today.
    await book(business, service, "2026-08-05T21:30:00Z");

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.todayCount).toBe(2);
  });

  it("excludes cancelled appointments from today and week counts", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW);

    await book(business, service, "2026-08-05T08:00:00Z");
    await book(business, service, "2026-08-05T09:00:00Z", "cancelled");

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.todayCount).toBe(1);
    expect(stats.weekCount).toBe(1);
  });

  it("counts the Sunday-start week", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW);

    await book(business, service, "2026-08-02T08:00:00Z"); // Sunday, in week
    await book(business, service, "2026-08-07T08:00:00Z"); // Friday, in week
    await book(business, service, "2026-08-01T08:00:00Z"); // Saturday, previous
    await book(business, service, "2026-08-09T08:00:00Z"); // next Sunday

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.weekCount).toBe(2);
  });

  it("counts everything still ahead as upcoming", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW);

    await book(business, service, "2026-08-05T11:00:00Z"); // an hour ago
    await book(business, service, "2026-08-05T13:00:00Z"); // in an hour
    await book(business, service, "2026-09-01T08:00:00Z"); // next month

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.upcomingCount).toBe(2);
  });

  it("measures rates only against appointments that have already started", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW);

    // Four in the past: 1 cancelled, 1 no-show, 2 completed.
    await book(business, service, "2026-08-01T08:00:00Z", "cancelled");
    await book(business, service, "2026-08-02T08:00:00Z", "no_show");
    await book(business, service, "2026-08-03T08:00:00Z", "completed");
    await book(business, service, "2026-08-04T08:00:00Z", "completed");
    // Future bookings must not dilute the denominator.
    await book(business, service, "2026-08-20T08:00:00Z");
    await book(business, service, "2026-08-21T08:00:00Z");

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.pastCount).toBe(4);
    expect(stats.cancelledCount).toBe(1);
    expect(stats.noShowCount).toBe(1);
    expect(toPercent(stats.cancelledCount, stats.pastCount)).toBe(25);
    expect(toPercent(stats.noShowCount, stats.pastCount)).toBe(25);
  });

  it("ignores appointments older than the rates window", async () => {
    const { business, service } = await setup();
    const windows = getStatsWindows(TZ, NOW, { ratesWindowDays: 30 });

    await book(business, service, "2026-06-01T08:00:00Z", "no_show"); // >30d
    await book(business, service, "2026-08-01T08:00:00Z", "no_show"); // inside

    const stats = await getDashboardStats(db, business.id, windows);
    expect(stats.pastCount).toBe(1);
    expect(stats.noShowCount).toBe(1);
  });

  it("returns zeros for a business with no appointments", async () => {
    const { business } = await setup();
    const stats = await getDashboardStats(
      db,
      business.id,
      getStatsWindows(TZ, NOW),
    );

    expect(stats).toEqual({
      todayCount: 0,
      weekCount: 0,
      upcomingCount: 0,
      pastCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
    });
  });

  it("never counts another business's appointments", async () => {
    const { business, service } = await setup();
    const other = await createBusiness(db);
    const otherService = await createService(db, other.id);

    await book(business, service, "2026-08-05T08:00:00Z");
    await createAppointment(
      db,
      other.id,
      otherService.id,
      new Date("2026-08-05T08:00:00Z"),
      new Date("2026-08-05T08:30:00Z"),
    );

    const stats = await getDashboardStats(
      db,
      business.id,
      getStatsWindows(TZ, NOW),
    );
    expect(stats.todayCount).toBe(1);
  });
});
