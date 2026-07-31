import { randomUUID } from "node:crypto";

import { fromZonedTime } from "date-fns-tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getActiveBusinessBySlug,
  getBusinessByOwner,
  getDashboardStats,
  getNextUpcomingAppointment,
  getService,
  listAppointmentsInRange,
} from "@/db/queries";
import type { Database } from "@/db/types";
import { getStatsWindows } from "@/lib/stats";
import {
  createAppointment,
  createBusiness,
  createService,
  createShift,
  TZ,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

/** Wednesday 2026-08-05, 12:00 UTC = 15:00 Israel. */
const NOW = new Date("2026-08-05T12:00:00Z");
const AGENDA_STATUSES = [
  "pending",
  "confirmed",
  "completed",
  "no_show",
] as const;

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

/** An owner who finished onboarding with a custom slug, exactly as 5A leaves them. */
async function seedOwner(slug: string) {
  const ownerUserId = randomUUID();
  const business = await createBusiness(db, {
    ownerUserId,
    slug,
    onboardingCompletedAt: NOW,
  });
  const service = await createService(db, business.id, { durationMin: 45 });
  for (const weekday of [0, 1, 2, 3, 4]) {
    await createShift(db, business.id, weekday, "09:00:00", "17:00:00");
  }
  return { ownerUserId, business, service };
}

/** What /dashboard renders for a given business-local day. */
async function agendaFor(businessId: string, timezone: string, day: string) {
  const start = fromZonedTime(`${day}T00:00:00`, timezone);
  const end = new Date(start.getTime() + 86_400_000);
  return listAppointmentsInRange(db, businessId, start, end, [
    ...AGENDA_STATUSES,
  ]);
}

describe("booking on a custom slug reaches that owner's dashboard", () => {
  it("resolves the same business by slug and by owner", async () => {
    const { ownerUserId, business } = await seedOwner("dana-cosmetics");

    const publicView = await getActiveBusinessBySlug(db, "dana-cosmetics");
    const dashboardView = await getBusinessByOwner(db, ownerUserId);

    expect(publicView?.id).toBe(business.id);
    expect(dashboardView?.id).toBe(business.id);
    expect(publicView?.id).toBe(dashboardView?.id);
  });

  it("writes the slug's business_id and shows up on that day's agenda", async () => {
    const { ownerUserId, service } = await seedOwner("dana-cosmetics");

    // Public flow: resolve by slug, then book — the action never trusts a
    // business id from the browser.
    const publicBusiness = (await getActiveBusinessBySlug(
      db,
      "dana-cosmetics",
    ))!;
    const startsAt = fromZonedTime("2026-08-06T09:00:00", TZ);

    const booked = await createAppointment(
      db,
      publicBusiness.id,
      service.id,
      startsAt,
      new Date(startsAt.getTime() + 45 * 60_000),
      { clientName: "גדי" },
    );
    expect(booked.businessId).toBe(publicBusiness.id);

    // Owner flow: resolve by session, then read that local day.
    const owned = (await getBusinessByOwner(db, ownerUserId))!;
    const agenda = await agendaFor(owned.id, owned.timezone, "2026-08-06");

    expect(agenda).toHaveLength(1);
    expect(agenda[0].id).toBe(booked.id);
    expect(agenda[0].clientName).toBe("גדי");
  });

  it("appears immediately when the booking is for today", async () => {
    const { ownerUserId, service } = await seedOwner("dana-cosmetics");
    const business = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;

    // 16:30 Israel on the same local day as NOW.
    const startsAt = fromZonedTime("2026-08-05T16:30:00", TZ);
    await createAppointment(
      db,
      business.id,
      service.id,
      startsAt,
      new Date(startsAt.getTime() + 45 * 60_000),
    );

    const owned = (await getBusinessByOwner(db, ownerUserId))!;
    const agenda = await agendaFor(owned.id, owned.timezone, "2026-08-05");
    expect(agenda).toHaveLength(1);

    const stats = await getDashboardStats(
      db,
      owned.id,
      getStatsWindows(TZ, NOW),
    );
    expect(stats.todayCount).toBe(1);
  });

  it("never leaks a booking into another owner's dashboard", async () => {
    const dana = await seedOwner("dana-cosmetics");
    const rival = await seedOwner("rival-salon");

    const business = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;
    const startsAt = fromZonedTime("2026-08-06T09:00:00", TZ);
    await createAppointment(
      db,
      business.id,
      dana.service.id,
      startsAt,
      new Date(startsAt.getTime() + 45 * 60_000),
    );

    const rivalBusiness = (await getBusinessByOwner(db, rival.ownerUserId))!;
    expect(
      await agendaFor(rivalBusiness.id, rivalBusiness.timezone, "2026-08-06"),
    ).toHaveLength(0);

    const danaBusiness = (await getBusinessByOwner(db, dana.ownerUserId))!;
    expect(
      await agendaFor(danaBusiness.id, danaBusiness.timezone, "2026-08-06"),
    ).toHaveLength(1);
  });

  it("rejects a service id belonging to a different business", async () => {
    await seedOwner("dana-cosmetics");
    const rival = await seedOwner("rival-salon");

    const dana = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;

    // The booking action scopes getService by the slug-resolved business, so a
    // foreign service id simply does not resolve.
    expect(await getService(db, dana.id, rival.service.id)).toBeNull();
  });
});

describe("a future booking is discoverable from an empty today", () => {
  it("is absent from today but surfaced as upcoming", async () => {
    const { ownerUserId, service } = await seedOwner("dana-cosmetics");
    const business = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;

    // The exact shape of the reported bug: booked days ahead.
    const startsAt = fromZonedTime("2026-08-06T09:00:00", TZ);
    await createAppointment(
      db,
      business.id,
      service.id,
      startsAt,
      new Date(startsAt.getTime() + 45 * 60_000),
      { clientName: "גדי" },
    );

    const owned = (await getBusinessByOwner(db, ownerUserId))!;

    // Today is legitimately empty — the agenda is not wrong.
    expect(
      await agendaFor(owned.id, owned.timezone, "2026-08-05"),
    ).toHaveLength(0);

    // ...but the dashboard must still tell the owner it exists.
    const stats = await getDashboardStats(
      db,
      owned.id,
      getStatsWindows(TZ, NOW),
    );
    expect(stats.todayCount).toBe(0);
    expect(stats.upcomingCount).toBe(1);

    const next = await getNextUpcomingAppointment(db, owned.id, NOW);
    expect(next?.clientName).toBe("גדי");
    expect(next?.startsAt.toISOString()).toBe(startsAt.toISOString());
  });

  it("ignores cancelled appointments when pointing at the next one", async () => {
    const { ownerUserId, service } = await seedOwner("dana-cosmetics");
    const business = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;

    const cancelled = fromZonedTime("2026-08-06T09:00:00", TZ);
    await createAppointment(
      db,
      business.id,
      service.id,
      cancelled,
      new Date(cancelled.getTime() + 45 * 60_000),
      { status: "cancelled", clientName: "בוטל" },
    );

    const live = fromZonedTime("2026-08-07T10:00:00", TZ);
    await createAppointment(
      db,
      business.id,
      service.id,
      live,
      new Date(live.getTime() + 45 * 60_000),
      { clientName: "פעיל" },
    );

    const owned = (await getBusinessByOwner(db, ownerUserId))!;
    const next = await getNextUpcomingAppointment(db, owned.id, NOW);
    expect(next?.clientName).toBe("פעיל");
  });

  it("returns nothing to point at when every booking is in the past", async () => {
    const { ownerUserId, service } = await seedOwner("dana-cosmetics");
    const business = (await getActiveBusinessBySlug(db, "dana-cosmetics"))!;

    const past = fromZonedTime("2026-08-03T09:00:00", TZ);
    await createAppointment(
      db,
      business.id,
      service.id,
      past,
      new Date(past.getTime() + 45 * 60_000),
    );

    const owned = (await getBusinessByOwner(db, ownerUserId))!;
    expect(await getNextUpcomingAppointment(db, owned.id, NOW)).toBeNull();
  });
});
