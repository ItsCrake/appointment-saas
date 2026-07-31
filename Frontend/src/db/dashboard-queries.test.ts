import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createService,
  createTimeOff,
  deactivateService,
  deleteService,
  deleteTimeOff,
  getBusinessByOwner,
  isSlugTaken,
  listServices,
  listUpcomingTimeOff,
  listWorkingHours,
  listWorkingHoursForWeekday,
  replaceWorkingHours,
  updateAppointmentStatus,
  updateService,
} from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService as makeService,
  createShift,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

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

describe("getBusinessByOwner", () => {
  it("resolves the dashboard's business from a user id", async () => {
    const ownerUserId = randomUUID();
    const business = await createBusiness(db, { ownerUserId });

    const found = await getBusinessByOwner(db, ownerUserId);
    expect(found?.id).toBe(business.id);
  });

  it("returns null for a user with no business, so setup can run", async () => {
    await createBusiness(db);
    expect(await getBusinessByOwner(db, randomUUID())).toBeNull();
  });
});

describe("isSlugTaken", () => {
  it("detects a collision and ignores the business's own slug", async () => {
    const business = await createBusiness(db, { slug: "ron-barber" });

    expect(await isSlugTaken(db, "ron-barber")).toBe(true);
    expect(await isSlugTaken(db, "ron-barber", business.id)).toBe(false);
    expect(await isSlugTaken(db, "someone-else")).toBe(false);
  });
});

describe("services CRUD", () => {
  it("creates, updates and hides a service", async () => {
    const business = await createBusiness(db);

    const created = await createService(db, {
      businessId: business.id,
      name: "תספורת",
      durationMin: 30,
      priceCents: 7000,
    });
    expect(created.isActive).toBe(true);

    const updated = await updateService(db, business.id, created.id, {
      name: "תספורת גבר",
      priceCents: 8000,
    });
    expect(updated?.name).toBe("תספורת גבר");
    expect(updated?.priceCents).toBe(8000);

    await deactivateService(db, business.id, created.id);
    expect(await listServices(db, business.id)).toHaveLength(0);
    expect(
      await listServices(db, business.id, { activeOnly: false }),
    ).toHaveLength(1);
  });

  it("refuses to update a service belonging to another business", async () => {
    const mine = await createBusiness(db);
    const theirs = await createBusiness(db);
    const service = await makeService(db, theirs.id);

    const result = await updateService(db, mine.id, service.id, {
      name: "hijacked",
    });

    expect(result).toBeNull();
    const untouched = await listServices(db, theirs.id);
    expect(untouched[0].name).not.toBe("hijacked");
  });

  it("deletes a service with no history", async () => {
    const business = await createBusiness(db);
    const service = await makeService(db, business.id);

    expect(await deleteService(db, business.id, service.id)).not.toBeNull();
    expect(await listServices(db, business.id)).toHaveLength(0);
  });

  it("cannot hard-delete a service that has appointments", async () => {
    const business = await createBusiness(db);
    const service = await makeService(db, business.id);
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    // ON DELETE RESTRICT — the UI falls back to deactivating.
    await expect(deleteService(db, business.id, service.id)).rejects.toThrow();

    await deactivateService(db, business.id, service.id);
    const [row] = await listServices(db, business.id, { activeOnly: false });
    expect(row.isActive).toBe(false);
  });
});

describe("replaceWorkingHours", () => {
  it("swaps the whole weekly template atomically", async () => {
    const business = await createBusiness(db);
    await createShift(db, business.id, 1, "09:00:00", "17:00:00");

    await replaceWorkingHours(db, business.id, [
      { weekday: 0, startTime: "10:00:00", endTime: "14:00:00" },
      { weekday: 0, startTime: "16:00:00", endTime: "20:00:00" },
    ]);

    const rows = await listWorkingHours(db, business.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.weekday === 0)).toBe(true);

    // The split shift survives the round trip.
    expect(await listWorkingHoursForWeekday(db, business.id, 0)).toHaveLength(
      2,
    );
    expect(await listWorkingHoursForWeekday(db, business.id, 1)).toHaveLength(
      0,
    );
  });

  it("clears the schedule when given an empty list", async () => {
    const business = await createBusiness(db);
    await createShift(db, business.id, 3, "09:00:00", "17:00:00");

    await replaceWorkingHours(db, business.id, []);
    expect(await listWorkingHours(db, business.id)).toHaveLength(0);
  });

  it("leaves another business's hours untouched", async () => {
    const mine = await createBusiness(db);
    const theirs = await createBusiness(db);
    await createShift(db, theirs.id, 2, "08:00:00", "12:00:00");

    await replaceWorkingHours(db, mine.id, [
      { weekday: 5, startTime: "09:00:00", endTime: "13:00:00" },
    ]);

    expect(await listWorkingHours(db, theirs.id)).toHaveLength(1);
  });

  it("rolls back entirely when a row violates the unique key", async () => {
    const business = await createBusiness(db);
    await createShift(db, business.id, 1, "09:00:00", "17:00:00");

    await expect(
      replaceWorkingHours(db, business.id, [
        { weekday: 0, startTime: "09:00:00", endTime: "12:00:00" },
        { weekday: 0, startTime: "09:00:00", endTime: "13:00:00" },
      ]),
    ).rejects.toThrow();

    // The transaction aborted, so the original Monday shift is still there.
    const rows = await listWorkingHours(db, business.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].weekday).toBe(1);
  });
});

describe("time off", () => {
  it("lists only entries that have not fully passed", async () => {
    const business = await createBusiness(db);
    const now = new Date("2026-08-03T00:00:00Z");

    await createTimeOff(db, {
      businessId: business.id,
      startsAt: new Date("2026-07-01T06:00:00Z"),
      endsAt: new Date("2026-07-01T10:00:00Z"),
      reason: "past",
    });
    await createTimeOff(db, {
      businessId: business.id,
      startsAt: new Date("2026-08-10T06:00:00Z"),
      endsAt: new Date("2026-08-10T10:00:00Z"),
      reason: "future",
    });

    const rows = await listUpcomingTimeOff(db, business.id, now);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("future");
  });

  it("only deletes within the owning business", async () => {
    const mine = await createBusiness(db);
    const theirs = await createBusiness(db);
    const entry = await createTimeOff(db, {
      businessId: theirs.id,
      startsAt: new Date("2026-08-10T06:00:00Z"),
      endsAt: new Date("2026-08-10T10:00:00Z"),
    });

    expect(await deleteTimeOff(db, mine.id, entry.id)).toBeNull();
    expect(await deleteTimeOff(db, theirs.id, entry.id)).not.toBeNull();
  });
});

describe("updateAppointmentStatus", () => {
  it("marks an appointment completed", async () => {
    const business = await createBusiness(db);
    const service = await makeService(db, business.id);
    const appointment = await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const updated = await updateAppointmentStatus(
      db,
      business.id,
      appointment.id,
      "completed",
    );
    expect(updated?.status).toBe("completed");
  });

  it("refuses to touch another business's appointment", async () => {
    const mine = await createBusiness(db);
    const theirs = await createBusiness(db);
    const service = await makeService(db, theirs.id);
    const appointment = await createAppointment(
      db,
      theirs.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const result = await updateAppointmentStatus(
      db,
      mine.id,
      appointment.id,
      "cancelled",
    );
    expect(result).toBeNull();
  });

  it("frees the slot once cancelled from the dashboard", async () => {
    const business = await createBusiness(db);
    const service = await makeService(db, business.id);
    const appointment = await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    await updateAppointmentStatus(db, business.id, appointment.id, "cancelled");

    // The exclusion constraint's partial index no longer counts it.
    await expect(
      createAppointment(
        db,
        business.id,
        service.id,
        new Date("2026-08-03T06:00:00Z"),
        new Date("2026-08-03T06:30:00Z"),
      ),
    ).resolves.toMatchObject({ status: "confirmed" });
  });
});
