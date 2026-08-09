import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listAppointmentsForClient } from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The query behind "התורים שלי".
 *
 * A phone number is the only thing identifying the person asking, so the
 * tenant scoping here is doing real work: a client who books at two shops on
 * this platform must not be able to see one shop's list from the other's page.
 * That is a property worth proving against Postgres rather than reading.
 */

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

const PHONE = "0501234567";
const OTHER_PHONE = "0509999999";

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

const at = (iso: string) => new Date(iso);

async function shop() {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 60 });
  const [alice] = await db.query.staff.findMany({
    where: (s, { eq }) => eq(s.businessId, business.id),
  });
  return { business, service, alice };
}

describe("listAppointmentsForClient", () => {
  it("returns this client's appointments at this business", async () => {
    const { business, service, alice } = await shop();

    await createAppointment(
      db,
      business.id,
      service.id,
      at("2026-08-03T06:00:00Z"),
      at("2026-08-03T07:00:00Z"),
      { staffId: alice.id, clientPhone: PHONE },
    );

    const rows = await listAppointmentsForClient(db, business.id, PHONE);

    expect(rows).toHaveLength(1);
    expect(rows[0].appointment.clientPhone).toBe(PHONE);
    expect(rows[0].staffName).toBe(alice.name);
  });

  it("never leaks another shop's bookings for the same number", async () => {
    // The property the whole feature rests on. One person, two shops on the
    // platform; each page shows only its own.
    const mine = await shop();
    const theirs = await shop();

    await createAppointment(
      db,
      mine.business.id,
      mine.service.id,
      at("2026-08-03T06:00:00Z"),
      at("2026-08-03T07:00:00Z"),
      { staffId: mine.alice.id, clientPhone: PHONE },
    );
    await createAppointment(
      db,
      theirs.business.id,
      theirs.service.id,
      at("2026-08-04T06:00:00Z"),
      at("2026-08-04T07:00:00Z"),
      { staffId: theirs.alice.id, clientPhone: PHONE },
    );

    const rows = await listAppointmentsForClient(db, mine.business.id, PHONE);

    expect(rows).toHaveLength(1);
    expect(rows[0].appointment.businessId).toBe(mine.business.id);
  });

  it("returns nothing for a number with no bookings here", async () => {
    const { business, service, alice } = await shop();

    await createAppointment(
      db,
      business.id,
      service.id,
      at("2026-08-03T06:00:00Z"),
      at("2026-08-03T07:00:00Z"),
      { staffId: alice.id, clientPhone: PHONE },
    );

    expect(
      await listAppointmentsForClient(db, business.id, OTHER_PHONE),
    ).toEqual([]);
  });

  it("matches the stored normalised form, not what was typed", async () => {
    // `createBookingAction` stores `normalizePhone(...)`, so the lookup has to
    // normalise too or a client who typed "+972-50-123-4567" finds nothing.
    const { business, service, alice } = await shop();

    await createAppointment(
      db,
      business.id,
      service.id,
      at("2026-08-03T06:00:00Z"),
      at("2026-08-03T07:00:00Z"),
      { staffId: alice.id, clientPhone: PHONE },
    );

    expect(
      await listAppointmentsForClient(db, business.id, "050-123-4567"),
    ).toEqual([]);
    expect(
      await listAppointmentsForClient(db, business.id, PHONE),
    ).toHaveLength(1);
  });

  it("returns every status, including cancelled ones", async () => {
    // History is the point of the page. Hiding a cancellation would leave a
    // client wondering whether their cancellation went through.
    const { business, service, alice } = await shop();

    for (const [i, status] of (
      ["confirmed", "cancelled", "completed"] as const
    ).entries()) {
      await createAppointment(
        db,
        business.id,
        service.id,
        at(`2026-08-0${i + 3}T06:00:00Z`),
        at(`2026-08-0${i + 3}T07:00:00Z`),
        { staffId: alice.id, clientPhone: PHONE, status },
      );
    }

    const rows = await listAppointmentsForClient(db, business.id, PHONE);
    expect(rows.map((r) => r.appointment.status).sort()).toEqual([
      "cancelled",
      "completed",
      "confirmed",
    ]);
  });

  it("orders newest first", async () => {
    const { business, service, alice } = await shop();

    for (const day of ["03", "05", "04"]) {
      await createAppointment(
        db,
        business.id,
        service.id,
        at(`2026-08-${day}T06:00:00Z`),
        at(`2026-08-${day}T07:00:00Z`),
        { staffId: alice.id, clientPhone: PHONE },
      );
    }

    const rows = await listAppointmentsForClient(db, business.id, PHONE);
    expect(
      rows.map((r) => r.appointment.startsAt.toISOString().slice(8, 10)),
    ).toEqual(["05", "04", "03"]);
  });

  it("names the provider who took each one", async () => {
    const { business, service, alice } = await shop();
    const bob = await createStaff(db, business.id, { name: "בוב" });

    await createAppointment(
      db,
      business.id,
      service.id,
      at("2026-08-03T06:00:00Z"),
      at("2026-08-03T07:00:00Z"),
      { staffId: bob.id, clientPhone: PHONE },
    );
    await createAppointment(
      db,
      business.id,
      service.id,
      at("2026-08-04T06:00:00Z"),
      at("2026-08-04T07:00:00Z"),
      { staffId: alice.id, clientPhone: PHONE },
    );

    const rows = await listAppointmentsForClient(db, business.id, PHONE);
    expect(rows.map((r) => r.staffName)).toEqual([alice.name, "בוב"]);
  });
});
