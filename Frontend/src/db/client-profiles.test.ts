import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getClientProfile,
  getClientStats,
  listClientHistory,
  mapClientNotes,
  upsertClientProfile,
} from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The client profile, keyed on `(business_id, client_phone)`.
 *
 * The tests that matter here are the identity ones. Everything else in this
 * product treats a phone number as the client, and a profile that disagreed
 * with that — by merging two people or splitting one — would be worse than no
 * profile at all, because the owner would be reading notes about somebody else.
 */

const NOW = new Date("2026-08-01T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

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

async function shop() {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 60 });
  return { business, service };
}

function booking(
  businessId: string,
  serviceId: string,
  {
    phone = "0501111111",
    name = "דני",
    at,
    status = "completed" as const,
    notes = null as string | null,
  }: {
    phone?: string;
    name?: string;
    at: Date;
    status?: "completed" | "confirmed" | "cancelled" | "no_show";
    notes?: string | null;
  },
) {
  return createAppointment(
    db,
    businessId,
    serviceId,
    at,
    new Date(at.getTime() + 3_600_000),
    { clientPhone: phone, clientName: name, status, notes },
  );
}

describe("client profiles", () => {
  it("has none until the owner writes one", async () => {
    const { business } = await shop();
    expect(await getClientProfile(db, business.id, "0501111111")).toBeNull();
  });

  it("creates on first write and updates thereafter", async () => {
    const { business } = await shop();

    await upsertClientProfile(db, business.id, "0501111111", "מעדיף בוקר");
    expect((await getClientProfile(db, business.id, "0501111111"))?.notes).toBe(
      "מעדיף בוקר",
    );

    // The unique key makes this an update, not a second row — which is what
    // stops two open tabs racing each other into a constraint violation.
    await upsertClientProfile(db, business.id, "0501111111", "מעדיף ערב");
    expect((await getClientProfile(db, business.id, "0501111111"))?.notes).toBe(
      "מעדיף ערב",
    );
  });

  it("keeps one tenant's notes invisible to another", async () => {
    // Two shops sharing a customer is normal. Two shops reading each other's
    // notes about them is a data leak dressed as a feature.
    const a = await shop();
    const b = await shop();

    await upsertClientProfile(db, a.business.id, "0501111111", "רגיש לצבע");

    expect(await getClientProfile(db, b.business.id, "0501111111")).toBeNull();
  });

  it("keys on the phone, so two people with one name stay apart", async () => {
    // The whole reason the key is not the name.
    const { business } = await shop();

    await upsertClientProfile(db, business.id, "0501111111", "דני הראשון");
    await upsertClientProfile(db, business.id, "0502222222", "דני השני");

    expect((await getClientProfile(db, business.id, "0501111111"))?.notes).toBe(
      "דני הראשון",
    );
    expect((await getClientProfile(db, business.id, "0502222222"))?.notes).toBe(
      "דני השני",
    );
  });

  it("keeps one person together when they spell their name differently", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, { name: "דני", at: daysAgo(30) });
    await booking(business.id, service.id, { name: "דניאל", at: daysAgo(5) });

    // One phone, one history, whatever they typed.
    const history = await listClientHistory(db, business.id, "0501111111");
    expect(history).toHaveLength(2);
  });

  it("omits blank notes from the phone map", async () => {
    // The map drives a marker icon and the calendar's hover card. A row that
    // exists but says nothing must not light either of them up.
    const { business } = await shop();
    await upsertClientProfile(db, business.id, "0501111111", "   ");
    await upsertClientProfile(db, business.id, "0502222222", "אלרגי");

    const map = await mapClientNotes(db, business.id);
    expect(map.has("0501111111")).toBe(false);
    expect(map.get("0502222222")).toBe("אלרגי");
  });
});

describe("client stats", () => {
  it("counts a past booking nobody marked completed as a visit", async () => {
    // Same rule the clients list uses for "last visit". A busy shop does not
    // tidy statuses, and the two figures would contradict each other otherwise.
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      at: daysAgo(3),
      status: "confirmed",
    });

    const stats = await getClientStats(db, business.id, "0501111111", NOW);
    expect(stats.completed).toBe(1);
  });

  it("separates cancellations and no-shows from visits", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(30) });
    await booking(business.id, service.id, {
      at: daysAgo(20),
      status: "cancelled",
    });
    await booking(business.id, service.id, {
      at: daysAgo(10),
      status: "no_show",
    });

    const stats = await getClientStats(db, business.id, "0501111111", NOW);
    expect(stats).toMatchObject({
      total: 3,
      completed: 1,
      cancelled: 1,
      noShow: 1,
      upcoming: 0,
    });
  });

  it("does not count a future booking as a visit", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      at: daysAhead(4),
      status: "confirmed",
    });

    const stats = await getClientStats(db, business.id, "0501111111", NOW);
    expect(stats.completed).toBe(0);
    expect(stats.upcoming).toBe(1);
  });

  it("is all zeroes for a phone with no history", async () => {
    const { business } = await shop();
    expect(
      await getClientStats(db, business.id, "0509999999", NOW),
    ).toMatchObject({ total: 0, completed: 0 });
  });

  it("never counts another tenant's bookings", async () => {
    const a = await shop();
    const b = await shop();
    await booking(a.business.id, a.service.id, { at: daysAgo(1) });

    expect(
      (await getClientStats(db, b.business.id, "0501111111", NOW)).total,
    ).toBe(0);
  });
});

describe("client history", () => {
  it("is newest first and carries the booking's own notes", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(30) });
    await booking(business.id, service.id, {
      at: daysAgo(2),
      notes: "מביא את הילד",
    });

    const history = await listClientHistory(db, business.id, "0501111111");
    expect(history[0].notes).toBe("מביא את הילד");
    expect(history[0].startsAt.getTime()).toBeGreaterThan(
      history[1].startsAt.getTime(),
    );
  });

  it("is scoped to one tenant", async () => {
    const a = await shop();
    const b = await shop();
    await booking(a.business.id, a.service.id, { at: daysAgo(1) });

    expect(await listClientHistory(db, b.business.id, "0501111111")).toEqual(
      [],
    );
  });
});
