import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { countNewClients, getDashboardStats } from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { getStatsWindows } from "@/lib/stats";
import { createTestDb } from "@/test/pglite";

const TZ = "Asia/Jerusalem";

/** Wednesday 12:00 local (09:00Z) — mid-week, so the Sunday week has a past. */
const NOW = new Date("2026-08-05T09:00:00Z");

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

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

const windows = () => getStatsWindows(TZ, NOW);

describe("todayRevenueCents", () => {
  it("is zero with no appointments, not null", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const stats = await getDashboardStats(db, business.id, windows());

    expect(stats.todayRevenueCents).toBe(0);
  });

  it("sums today's prices in the business timezone", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    // Both on 2026-08-05 local.
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-05T06:00:00Z"),
      new Date("2026-08-05T06:30:00Z"),
      { priceCents: 7000 },
    );
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-05T11:00:00Z"),
      new Date("2026-08-05T11:30:00Z"),
      { priceCents: 3000 },
    );

    const stats = await getDashboardStats(db, business.id, windows());
    expect(stats.todayRevenueCents).toBe(10000);
  });

  it("excludes cancelled appointments — that money is not expected", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-05T06:00:00Z"),
      new Date("2026-08-05T06:30:00Z"),
      { priceCents: 7000 },
    );
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-05T08:00:00Z"),
      new Date("2026-08-05T08:30:00Z"),
      { priceCents: 5000, status: "cancelled" },
    );

    const stats = await getDashboardStats(db, business.id, windows());
    expect(stats.todayRevenueCents).toBe(7000);
  });

  it("ignores other days", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-06T06:00:00Z"),
      new Date("2026-08-06T06:30:00Z"),
      { priceCents: 9900 },
    );

    const stats = await getDashboardStats(db, business.id, windows());
    expect(stats.todayRevenueCents).toBe(0);
  });
});

describe("countNewClients", () => {
  const week = () => {
    const w = windows();
    return { from: w.weekStart, to: w.weekEnd };
  };

  it("counts a phone whose first booking is inside the window", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-04T06:00:00Z"),
      new Date("2026-08-04T06:30:00Z"),
      { clientPhone: "0501111111" },
    );

    expect(await countNewClients(db, business.id, week())).toBe(1);
  });

  it("does not count a returning client as new", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    // First visit was last month; this week's booking is a return.
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-07-01T06:00:00Z"),
      new Date("2026-07-01T06:30:00Z"),
      { clientPhone: "0502222222" },
    );
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-04T06:00:00Z"),
      new Date("2026-08-04T06:30:00Z"),
      { clientPhone: "0502222222" },
    );

    expect(await countNewClients(db, business.id, week())).toBe(0);
  });

  it("counts a phone once however many times it books this week", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    for (const hour of ["06:00", "08:00", "10:00"]) {
      await createAppointment(
        db,
        business.id,
        service.id,
        new Date(`2026-08-04T${hour}:00Z`),
        new Date(`2026-08-04T${hour}:00Z`),
        { clientPhone: "0503333333" },
      );
    }

    expect(await countNewClients(db, business.id, week())).toBe(1);
  });

  it("ignores a client whose only booking was cancelled", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-04T06:00:00Z"),
      new Date("2026-08-04T06:30:00Z"),
      { clientPhone: "0504444444", status: "cancelled" },
    );

    expect(await countNewClients(db, business.id, week())).toBe(0);
  });

  it("does not leak across tenants", async () => {
    const mine = await createBusiness(db, { timezone: TZ });
    const theirs = await createBusiness(db, { timezone: TZ });
    const myService = await createService(db, mine.id);
    const theirService = await createService(db, theirs.id);

    await createAppointment(
      db,
      mine.id,
      myService.id,
      new Date("2026-08-04T06:00:00Z"),
      new Date("2026-08-04T06:30:00Z"),
      { clientPhone: "0505555555" },
    );
    await createAppointment(
      db,
      theirs.id,
      theirService.id,
      new Date("2026-08-04T07:00:00Z"),
      new Date("2026-08-04T07:30:00Z"),
      { clientPhone: "0506666666" },
    );

    expect(await countNewClients(db, mine.id, week())).toBe(1);
    expect(await countNewClients(db, theirs.id, week())).toBe(1);
  });

  it("is surfaced on the dashboard stats payload", async () => {
    const business = await createBusiness(db, { timezone: TZ });
    const service = await createService(db, business.id);

    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-04T06:00:00Z"),
      new Date("2026-08-04T06:30:00Z"),
      { clientPhone: "0507777777" },
    );

    const stats = await getDashboardStats(db, business.id, windows());
    expect(stats.newClientsThisWeek).toBe(1);
  });
});
