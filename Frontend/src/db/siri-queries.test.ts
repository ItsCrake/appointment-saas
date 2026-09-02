import { fromZonedTime } from "date-fns-tz";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getBusinessBySiriToken,
  nextAppointment,
  searchUpcomingByClient,
  setSiriToken,
  todaySummary,
} from "@/db/queries/siri";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";
import { generateSiriToken } from "@/lib/siri/token";

/**
 * The Siri data layer, against real Postgres.
 *
 * ---------------------------------------------------------------------------
 * Which also proves migration 0030: this harness replays `src/db/migrations`
 * exactly as production does, so a column or a partial unique index that does
 * not apply cleanly fails here rather than on a deploy — the ordering rule in
 * PROJECT_PLAN §5 exists because that failure takes the booking page and the
 * whole dashboard with it.
 *
 * The tenant isolation assertion is the one that matters most. This token is
 * the *only* thing the endpoint uses to decide whose calendar it is reading —
 * there is no session behind it and no business id in the request — so "a token
 * reaches exactly one business, and that business's rows only" is the whole
 * security model, stated as a test.
 * ---------------------------------------------------------------------------
 */
let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

const TZ = "Asia/Jerusalem";
/** Thursday, 12:00 in Jerusalem. */
const NOW = new Date("2026-09-03T09:00:00Z");

async function shop() {
  const business = await createBusiness(db, { timezone: TZ });
  const service = await createService(db, business.id, { durationMin: 30 });
  return { business, service };
}

async function book(
  ctx: Awaited<ReturnType<typeof shop>>,
  startsAt: string,
  clientName: string,
  overrides: Parameters<typeof createAppointment>[5] = {},
) {
  const from = new Date(startsAt);
  return createAppointment(
    db,
    ctx.business.id,
    ctx.service.id,
    from,
    new Date(from.getTime() + 30 * 60_000),
    { clientName, ...overrides },
  );
}

describe("the token is the whole key", () => {
  it("resolves to exactly one business", async () => {
    const { business } = await shop();
    const token = generateSiriToken();

    expect(await getBusinessBySiriToken(db, token)).toBeNull();

    await setSiriToken(db, business.id, token);
    const found = await getBusinessBySiriToken(db, token);

    expect(found?.id).toBe(business.id);
    expect(found?.timezone).toBe(TZ);
  });

  it("stops resolving the moment it is revoked", async () => {
    // Clearing the column is a full revoke: it is the only copy, so there is
    // no session to expire and no cache holding a duplicate.
    const { business } = await shop();
    const token = generateSiriToken();
    await setSiriToken(db, business.id, token);
    await setSiriToken(db, business.id, null);

    expect(await getBusinessBySiriToken(db, token)).toBeNull();
  });

  it("replaces rather than accumulates", async () => {
    // Generate and regenerate are one UPDATE. The old token has to stop working
    // on the same write that mints the new one, or "regenerate" is not a revoke.
    const { business } = await shop();
    const first = generateSiriToken();
    const second = generateSiriToken();

    await setSiriToken(db, business.id, first);
    await setSiriToken(db, business.id, second);

    expect(await getBusinessBySiriToken(db, first)).toBeNull();
    expect((await getBusinessBySiriToken(db, second))?.id).toBe(business.id);
  });

  it("refuses to let two businesses share one token", async () => {
    /**
     * The partial unique index from 0030. Two shops answering to one credential
     * would mean an owner hearing somebody else's day, and the database is the
     * only place that can make it impossible rather than unlikely.
     */
    const a = await shop();
    const b = await shop();
    const token = generateSiriToken();

    await setSiriToken(db, a.business.id, token);
    await expect(setSiriToken(db, b.business.id, token)).rejects.toThrow();
  });

  it("lets any number of businesses have no token", async () => {
    // The index is partial for exactly this: NULL is the default and most
    // tenants will never enable the feature.
    await shop();
    await shop();
    expect(await getBusinessBySiriToken(db, generateSiriToken())).toBeNull();
  });
});

describe("nextAppointment", () => {
  it("finds the soonest one after now, across days", async () => {
    const ctx = await shop();
    await book(ctx, "2026-09-05T07:00:00Z", "מאוחר");
    await book(ctx, "2026-09-03T11:00:00Z", "הקרוב");
    await book(ctx, "2026-09-03T06:00:00Z", "כבר עבר");

    const next = await nextAppointment(db, ctx.business.id, NOW);
    expect(next?.clientName).toBe("הקרוב");
  });

  it("never reaches another business's calendar", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-03T10:00:00Z", "לקוח של מישהו אחר");

    expect(await nextAppointment(db, mine.business.id, NOW)).toBeNull();
  });

  it("ignores cancelled and no-show bookings", async () => {
    /**
     * A cancelled slot is free and a no-show has been and gone. Announcing
     * either sends an owner to meet somebody who is not coming — and both sit
     * in the same table as live bookings, so only the status filter separates
     * them.
     */
    const ctx = await shop();
    await book(ctx, "2026-09-03T10:00:00Z", "ביטל", { status: "cancelled" });
    await book(ctx, "2026-09-03T10:30:00Z", "לא הגיע", { status: "no_show" });
    await book(ctx, "2026-09-03T12:00:00Z", "מגיע");

    expect((await nextAppointment(db, ctx.business.id, NOW))?.clientName).toBe(
      "מגיע",
    );
  });
});

describe("todaySummary", () => {
  const dayStart = fromZonedTime("2026-09-03T00:00:00", TZ);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  it("counts the shop's day and names what is still ahead", async () => {
    const ctx = await shop();
    await book(ctx, "2026-09-03T05:00:00Z", "בוקר"); // 08:00 — past
    await book(ctx, "2026-09-03T11:00:00Z", "צהריים"); // 14:00 — ahead
    await book(ctx, "2026-09-03T13:00:00Z", "אחר הצהריים"); // 16:00 — ahead

    const { total, next } = await todaySummary(
      db,
      ctx.business.id,
      dayStart,
      dayEnd,
      NOW,
    );

    expect(total).toBe(3);
    expect(next?.clientName).toBe("צהריים");
  });

  it("counts the whole day but returns nothing ahead once it is over", async () => {
    // The "past business hours" case: the count is still three, and there is
    // no next — which is what stops the sentence using the future tense.
    const ctx = await shop();
    await book(ctx, "2026-09-03T05:00:00Z", "א");
    await book(ctx, "2026-09-03T06:00:00Z", "ב");

    const late = new Date("2026-09-03T18:00:00Z");
    const { total, next } = await todaySummary(
      db,
      ctx.business.id,
      dayStart,
      dayEnd,
      late,
    );

    expect(total).toBe(2);
    expect(next).toBeNull();
  });

  it("uses the shop's midnight, not the server's", async () => {
    /**
     * 21:30Z on the 3rd is 00:30 on the 4th in Jerusalem. A window built on UTC
     * days would count it as today and tell an owner at breakfast that they had
     * an appointment they have already slept through.
     */
    const ctx = await shop();
    await book(ctx, "2026-09-03T21:30:00Z", "אחרי חצות אצלנו");

    const { total } = await todaySummary(
      db,
      ctx.business.id,
      dayStart,
      dayEnd,
      NOW,
    );
    expect(total).toBe(0);
  });
});

describe("searchUpcomingByClient", () => {
  it("matches part of a name, case-insensitively", async () => {
    const ctx = await shop();
    await book(ctx, "2026-09-04T07:00:00Z", "דניאל לוי");

    const found = await searchUpcomingByClient(db, ctx.business.id, "דניאל", NOW);
    expect(found).toHaveLength(1);
    expect(found[0].clientName).toBe("דניאל לוי");
  });

  it("does not treat a wildcard in the query as a wildcard", async () => {
    /**
     * A name arrives from dictation and can contain anything. Unescaped, `%`
     * turns a search for one client into a match on every client — and the
     * owner hears somebody else's booking read out because Siri mis-heard.
     */
    const ctx = await shop();
    await book(ctx, "2026-09-04T07:00:00Z", "דניאל לוי");

    expect(await searchUpcomingByClient(db, ctx.business.id, "%", NOW)).toEqual(
      [],
    );
    expect(await searchUpcomingByClient(db, ctx.business.id, "_", NOW)).toEqual(
      [],
    );
  });

  it("looks forward only, and stays inside the tenant", async () => {
    const ctx = await shop();
    const other = await shop();
    await book(ctx, "2026-09-03T05:00:00Z", "דניאל בעבר");
    await book(other, "2026-09-04T07:00:00Z", "דניאל של אחרים");

    expect(await searchUpcomingByClient(db, ctx.business.id, "דניאל", NOW)).toEqual(
      [],
    );
  });

  it("caps how many it returns", async () => {
    // The caller names the first and counts the rest; an unbounded query would
    // pull a year of bookings to speak one sentence.
    const ctx = await shop();
    for (let i = 0; i < 8; i++) {
      await book(ctx, `2026-09-0${4 + Math.floor(i / 4)}T0${i % 4 + 5}:00:00Z`, "דניאל");
    }

    const found = await searchUpcomingByClient(db, ctx.business.id, "דניאל", NOW);
    expect(found.length).toBeLessThanOrEqual(5);
  });
});
