import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMarketingOptOut,
  listWinBackCandidates,
} from "@/db/queries/retention";
import { updateBusiness } from "@/db/queries";
import type { Database } from "@/db/types";
import { enqueueWinBack } from "@/lib/notifications/enqueue";
import { renderNotification } from "@/lib/notifications/templates";
import { retentionBlockedReason, INACTIVE_DAYS } from "@/lib/retention";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/**
 * The eligibility rules for the one marketing message this product sends.
 *
 * Every case here is a person who must **not** be contacted, plus the one who
 * may. That balance is deliberate: the cost of a false negative is a message
 * nobody sends, and the cost of a false positive is a commercial approach
 * somebody never agreed to, delivered over the tenant's own WhatsApp number.
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
  const business = await createBusiness(db, { retentionEnabled: true });
  const service = await createService(db, business.id, { durationMin: 60 });
  return { business, service };
}

/** A past visit, consented unless told otherwise. */
async function visited(
  businessId: string,
  serviceId: string,
  {
    phone,
    daysSince,
    consented = true,
    status = "completed" as const,
  }: {
    phone: string;
    daysSince: number;
    consented?: boolean;
    status?: "completed" | "confirmed" | "cancelled" | "no_show";
  },
) {
  const startsAt = daysAgo(daysSince);
  return createAppointment(
    db,
    businessId,
    serviceId,
    startsAt,
    new Date(startsAt.getTime() + 3_600_000),
    {
      clientPhone: phone,
      clientName: "דני",
      status,
      clientConsentedMarketing: consented,
    },
  );
}

const candidates = (businessId: string) =>
  listWinBackCandidates(db, businessId, {
    now: NOW,
    inactiveDays: INACTIVE_DAYS,
    limit: 25,
  });

describe("win-back eligibility", () => {
  it("includes a consented client who lapsed and has nothing booked", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0501111111",
      daysSince: 30,
    });

    const rows = await candidates(business.id);
    expect(rows.map((r) => r.phone)).toEqual(["0501111111"]);
  });

  it("excludes a client who never consented", async () => {
    // The single most important row in this file. Everything else is about
    // relevance; this one is about lawfulness.
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0502222222",
      daysSince: 30,
      consented: false,
    });

    expect(await candidates(business.id)).toEqual([]);
  });

  it("reads consent from the latest visit, not from any visit", async () => {
    // Withdrawing consent has to be as easy as giving it: leaving the box
    // unticked next time is the whole mechanism, and there is no form to fill
    // in. An older ticked box must not resurrect it.
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0503333333",
      daysSince: 90,
      consented: true,
    });
    await visited(business.id, service.id, {
      phone: "0503333333",
      daysSince: 30,
      consented: false,
    });

    expect(await candidates(business.id)).toEqual([]);
  });

  it("picks up consent granted on a later visit", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0504444444",
      daysSince: 90,
      consented: false,
    });
    await visited(business.id, service.id, {
      phone: "0504444444",
      daysSince: 30,
      consented: true,
    });

    expect((await candidates(business.id)).map((r) => r.phone)).toEqual([
      "0504444444",
    ]);
  });

  it("excludes a client who has not lapsed yet", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0505555555",
      daysSince: INACTIVE_DAYS - 1,
    });

    expect(await candidates(business.id)).toEqual([]);
  });

  it("excludes a client with a future booking", async () => {
    // "We miss you" to somebody who is already coming next week reads as a
    // shop that does not know who its own customers are.
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0506666666",
      daysSince: 60,
    });
    await createAppointment(
      db,
      business.id,
      service.id,
      daysAhead(5),
      new Date(daysAhead(5).getTime() + 3_600_000),
      { clientPhone: "0506666666", clientConsentedMarketing: true },
    );

    expect(await candidates(business.id)).toEqual([]);
  });

  it("still contacts a client whose only future booking was cancelled", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0507777777",
      daysSince: 60,
    });
    await createAppointment(
      db,
      business.id,
      service.id,
      daysAhead(5),
      new Date(daysAhead(5).getTime() + 3_600_000),
      {
        clientPhone: "0507777777",
        status: "cancelled",
        clientConsentedMarketing: true,
      },
    );

    expect((await candidates(business.id)).map((r) => r.phone)).toEqual([
      "0507777777",
    ]);
  });

  it("excludes someone whose only booking was cancelled", async () => {
    // They never became a customer, so there is no relationship to win back.
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0508888888",
      daysSince: 60,
      status: "cancelled",
    });

    expect(await candidates(business.id)).toEqual([]);
  });

  it("excludes a client who has opted out", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0509999999",
      daysSince: 60,
    });
    expect((await candidates(business.id)).length).toBe(1);

    await addMarketingOptOut(db, business.id, "0509999999", "replied הסר");
    expect(await candidates(business.id)).toEqual([]);
  });

  it("treats a repeated opt-out as a no-op", async () => {
    const { business } = await shop();
    await addMarketingOptOut(db, business.id, "0501234567");
    await expect(
      addMarketingOptOut(db, business.id, "0501234567"),
    ).resolves.not.toThrow();
  });

  it("scopes opt-outs to the business they were given to", async () => {
    // Consent is given to a shop, not to the platform. Opting out of a barber
    // must not silently opt you out of a clinic you are happy to hear from.
    const a = await shop();
    const b = await shop();
    await visited(a.business.id, a.service.id, {
      phone: "0505550000",
      daysSince: 60,
    });
    await visited(b.business.id, b.service.id, {
      phone: "0505550000",
      daysSince: 60,
    });

    await addMarketingOptOut(db, a.business.id, "0505550000");

    expect(await candidates(a.business.id)).toEqual([]);
    expect((await candidates(b.business.id)).map((r) => r.phone)).toEqual([
      "0505550000",
    ]);
  });

  it("never leaks one tenant's clients into another's list", async () => {
    const a = await shop();
    const b = await shop();
    await visited(a.business.id, a.service.id, {
      phone: "0501111000",
      daysSince: 60,
    });

    expect(await candidates(b.business.id)).toEqual([]);
  });

  it("returns the lapsed visit, longest-lapsed first", async () => {
    const { business, service } = await shop();
    await visited(business.id, service.id, {
      phone: "0501000001",
      daysSince: 30,
    });
    await visited(business.id, service.id, {
      phone: "0501000002",
      daysSince: 90,
    });

    const rows = await candidates(business.id);
    expect(rows.map((r) => r.phone)).toEqual(["0501000002", "0501000001"]);
    // The appointment id is what the dedupe key is built from, so it has to be
    // the lapsed visit rather than any row for that client.
    expect(rows[0].appointmentId).toBeTruthy();
  });

  it("caps a single run", async () => {
    const { business, service } = await shop();
    for (let i = 0; i < 5; i++) {
      await visited(business.id, service.id, {
        phone: `05010000${10 + i}`,
        daysSince: 30 + i,
      });
    }

    const rows = await listWinBackCandidates(db, business.id, {
      now: NOW,
      inactiveDays: INACTIVE_DAYS,
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });
});

describe("retentionBlockedReason", () => {
  it("blocks a tenant who has not switched it on", async () => {
    const business = await createBusiness(db, { retentionEnabled: false });
    expect(retentionBlockedReason(business)).toBe("not enabled");
  });

  it("blocks a tenant whose plan does not include it", async () => {
    // Enabled on a plan that lost the entitlement — a lapsed Pro tenant. The
    // switch stays on so it resumes on payment, but nothing sends meanwhile.
    const business = await createBusiness(db, {
      retentionEnabled: true,
      planType: "starter",
      subscriptionStatus: "active",
    });
    expect(retentionBlockedReason(business)).toBe("not entitled");
  });

  it("blocks a frozen tenant", async () => {
    const { business } = await shop();
    const frozen = await updateBusiness(db, business.id, { isActive: false });
    expect(retentionBlockedReason(frozen!)).toBe("frozen");
  });

  it("blocks when WhatsApp is not configured", async () => {
    // No credentials in the test environment, so the channel resolves to the
    // console provider — which reports success and delivers nothing. Sending
    // there would leave an owner believing a campaign is running.
    const { business } = await shop();
    expect(retentionBlockedReason(business)).toBe("whatsapp not configured");
  });
});

describe("the win-back message itself", () => {
  it("is queued once per lapse, however often the sweep runs", async () => {
    // The dedupe key is the lapsed appointment, not a time bucket. A client who
    // never returns therefore gets exactly one message, ever — a bucketed key
    // would re-send on a schedule, which is the shape of the thing everyone
    // means by spam.
    const { business, service } = await shop();
    const appointment = await visited(business.id, service.id, {
      phone: "0502000001",
      daysSince: 30,
    });

    const first = await enqueueWinBack({
      db,
      business,
      candidate: { phone: "0502000001", appointmentId: appointment.id },
      now: NOW,
    });
    const second = await enqueueWinBack({
      db,
      business,
      candidate: { phone: "0502000001", appointmentId: appointment.id },
      now: NOW,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("names the sender and carries a way out", async () => {
    const { subject, body } = renderNotification({
      kind: "client_winback",
      businessName: "מספרת ברקאי",
      businessPhone: null,
      businessAddress: null,
      businessTimezone: "Asia/Jerusalem",
      bookingUrl: "https://example.com/barkai",
      manageUrl: "https://example.com/b/token",
      clientName: "דני",
      serviceName: "תספורת",
      priceCents: 7000,
      startsAt: NOW.toISOString(),
      status: "completed",
    });

    // דבר פרסומת must identify who is advertising. An unsigned "we miss you"
    // from an unknown number is both unlawful and indistinguishable from a scam.
    expect(subject).toContain("מספרת ברקאי");
    expect(body).toContain("מספרת ברקאי");
    // The opt-out is in the message, not behind a link: a one-word reply is the
    // lowest-friction exit WhatsApp offers.
    expect(body).toContain("הסר");
    expect(body).toContain("https://example.com/barkai");
  });

  it("does not quote the client's last visit back at them", () => {
    // Every other client template leads with a date. This one is about the
    // absence of one, and naming when somebody last came in reads as
    // surveillance rather than warmth.
    const { body } = renderNotification({
      kind: "client_winback",
      businessName: "מספרה",
      businessPhone: null,
      businessAddress: null,
      businessTimezone: "Asia/Jerusalem",
      bookingUrl: "https://example.com/x",
      manageUrl: "https://example.com/b/t",
      clientName: "דני",
      serviceName: "תספורת",
      priceCents: 7000,
      startsAt: "2026-06-01T09:00:00Z",
      status: "completed",
    });

    expect(body).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
