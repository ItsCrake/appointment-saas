import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listClients } from "@/db/queries";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * "Last visit" in the clients list.
 *
 * It used to be a plain `max(starts_at)` over every row of that client's
 * history, which is wrong in two directions at once and — this is what made it
 * survive — wrong in a way that always looks plausible. A date appears, it is
 * roughly the right shape, and nobody checks it against the calendar.
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

async function booking(
  businessId: string,
  serviceId: string,
  {
    phone = "0501111111",
    at,
    status = "completed" as const,
  }: {
    phone?: string;
    at: Date;
    status?: "completed" | "confirmed" | "pending" | "cancelled" | "no_show";
  },
) {
  return createAppointment(
    db,
    businessId,
    serviceId,
    at,
    new Date(at.getTime() + 3_600_000),
    { clientPhone: phone, clientName: "דני", status },
  );
}

const clients = (businessId: string) => listClients(db, businessId, NOW);

describe("last visit", () => {
  it("is the most recent appointment that actually happened", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(30) });
    await booking(business.id, service.id, { at: daysAgo(10) });

    const [client] = await clients(business.id);
    expect(client.lastVisit?.toISOString()).toBe(daysAgo(10).toISOString());
  });

  it("ignores a cancellation, however recent", async () => {
    // The reported bug. A regular who cancelled last week read as freshly
    // seen, so a shop chasing lapsed clients skipped exactly the person who
    // had stopped coming.
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(60) });
    await booking(business.id, service.id, {
      at: daysAgo(2),
      status: "cancelled",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit?.toISOString()).toBe(daysAgo(60).toISOString());
  });

  it("ignores a no-show, for the same reason", async () => {
    // The chair sat empty. That is not a visit, whatever the calendar says.
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(60) });
    await booking(business.id, service.id, {
      at: daysAgo(2),
      status: "no_show",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit?.toISOString()).toBe(daysAgo(60).toISOString());
  });

  it("ignores an appointment that has not happened yet", async () => {
    // The other half of the bug, and the sillier-looking one: a "last visit"
    // column printing a date next month.
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(14) });
    await booking(business.id, service.id, {
      at: daysAhead(7),
      status: "confirmed",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit?.toISOString()).toBe(daysAgo(14).toISOString());
  });

  it("counts a past booking nobody marked completed", async () => {
    // A busy shop does not go back and tidy statuses. The appointment ran.
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      at: daysAgo(3),
      status: "confirmed",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit?.toISOString()).toBe(daysAgo(3).toISOString());
  });

  it("is null for a client who has booked but never been in", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      at: daysAhead(3),
      status: "confirmed",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit).toBeNull();
    // Still a client, and still countable — they have a booking.
    expect(client.bookings).toBe(1);
  });

  it("is null when every booking was cancelled", async () => {
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      at: daysAgo(5),
      status: "cancelled",
    });

    const [client] = await clients(business.id);
    expect(client.lastVisit).toBeNull();
  });

  it("still counts cancellations under bookings", async () => {
    // A different question, and a legitimate one: how much has this person
    // ever booked. The column is labelled "תורים", not "ביקורים".
    const { business, service } = await shop();
    await booking(business.id, service.id, { at: daysAgo(30) });
    await booking(business.id, service.id, {
      at: daysAgo(2),
      status: "cancelled",
    });

    const [client] = await clients(business.id);
    expect(client.bookings).toBe(2);
  });

  it("sorts never-visited clients last rather than first", async () => {
    // Postgres orders nulls *first* under DESC, so without NULLS LAST the top
    // of the list would be everyone who has never walked in.
    const { business, service } = await shop();
    await booking(business.id, service.id, {
      phone: "0501111111",
      at: daysAgo(20),
    });
    await booking(business.id, service.id, {
      phone: "0502222222",
      at: daysAgo(5),
    });
    await booking(business.id, service.id, {
      phone: "0503333333",
      at: daysAhead(5),
      status: "confirmed",
    });

    expect((await clients(business.id)).map((c) => c.clientPhone)).toEqual([
      "0502222222",
      "0501111111",
      "0503333333",
    ]);
  });

  it("keeps one tenant's clients out of another's list", async () => {
    const a = await shop();
    const b = await shop();
    await booking(a.business.id, a.service.id, { at: daysAgo(1) });

    expect(await clients(b.business.id)).toEqual([]);
  });
});
