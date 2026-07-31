import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pruneExpiredRateLimits } from "@/db/queries/rate-limits";
import type { Database } from "@/db/types";
import {
  BOOKING_RULES,
  buildRateLimitKey,
  decide,
  HOUR_MS,
  rateLimitMessage,
  type RateLimitRule,
} from "@/lib/rate-limit";
import { enforceRateLimits } from "@/lib/rate-limit-guard";
import { looksAutomated, MIN_HUMAN_FILL_MS } from "@/lib/validation";
import { createTestDb } from "@/test/pglite";

const NOW = new Date("2026-08-05T12:34:56Z");

describe("buildRateLimitKey", () => {
  const rule: RateLimitRule = { scope: "t", limit: 5, windowMs: HOUR_MS };

  it("floors the window so a key is stable within it", () => {
    const a = buildRateLimitKey(
      rule,
      "1.2.3.4",
      new Date("2026-08-05T12:00:00Z"),
    );
    const b = buildRateLimitKey(
      rule,
      "1.2.3.4",
      new Date("2026-08-05T12:59:59Z"),
    );
    expect(a.key).toBe(b.key);
    expect(a.windowStart.toISOString()).toBe("2026-08-05T12:00:00.000Z");
    expect(a.expiresAt.toISOString()).toBe("2026-08-05T13:00:00.000Z");
  });

  it("rolls to a new key at the window boundary", () => {
    const a = buildRateLimitKey(
      rule,
      "1.2.3.4",
      new Date("2026-08-05T12:59:59Z"),
    );
    const b = buildRateLimitKey(
      rule,
      "1.2.3.4",
      new Date("2026-08-05T13:00:00Z"),
    );
    expect(a.key).not.toBe(b.key);
  });

  it("keeps different identifiers in different buckets", () => {
    const a = buildRateLimitKey(rule, "1.2.3.4", NOW);
    const b = buildRateLimitKey(rule, "5.6.7.8", NOW);
    expect(a.key).not.toBe(b.key);
  });
});

describe("decide", () => {
  const rule: RateLimitRule = { scope: "t", limit: 3, windowMs: HOUR_MS };
  const expiresAt = new Date(NOW.getTime() + 10 * 60_000);

  it("allows up to and including the limit", () => {
    expect(decide(rule, 3, expiresAt, NOW).allowed).toBe(true);
    expect(decide(rule, 3, expiresAt, NOW).remaining).toBe(0);
  });

  it("blocks past the limit", () => {
    expect(decide(rule, 4, expiresAt, NOW).allowed).toBe(false);
  });

  it("reports seconds until the window resets", () => {
    expect(decide(rule, 1, expiresAt, NOW).retryAfterSeconds).toBe(600);
  });
});

describe("rateLimitMessage", () => {
  it("uses minutes for a short wait", () => {
    const message = rateLimitMessage({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: NOW,
      retryAfterSeconds: 600,
    });
    expect(message).toContain("10 דקות");
  });

  it("switches to hours for a long wait", () => {
    const message = rateLimitMessage({
      allowed: false,
      limit: 5,
      remaining: 0,
      resetAt: NOW,
      retryAfterSeconds: 7200,
    });
    expect(message).toContain("שעות");
  });
});

describe("looksAutomated", () => {
  it("trips when the honeypot has any content", () => {
    expect(looksAutomated({ contactReference: "http://spam" })).toMatchObject({
      automated: true,
    });
  });

  it("ignores an empty or whitespace-only honeypot", () => {
    expect(looksAutomated({ contactReference: "" }).automated).toBe(false);
    expect(looksAutomated({ contactReference: "   " }).automated).toBe(false);
    expect(looksAutomated({}).automated).toBe(false);
  });

  it("trips on an implausibly fast submit", () => {
    expect(looksAutomated({ elapsedMs: 200 }).automated).toBe(true);
  });

  it("accepts a human-paced submit", () => {
    expect(looksAutomated({ elapsedMs: MIN_HUMAN_FILL_MS + 1 }).automated).toBe(
      false,
    );
  });
});

describe("enforceRateLimits", () => {
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
    await harness.pg.exec("TRUNCATE rate_limits");
  });

  const ipRule = BOOKING_RULES.ipHourly;

  it("allows exactly `limit` requests then blocks", async () => {
    for (let i = 0; i < ipRule.limit; i++) {
      const result = await enforceRateLimits(
        db,
        [{ rule: ipRule, identifier: "1.2.3.4" }],
        NOW,
      );
      expect(result.allowed).toBe(true);
    }

    const blocked = await enforceRateLimits(
      db,
      [{ rule: ipRule, identifier: "1.2.3.4" }],
      NOW,
    );
    expect(blocked.allowed).toBe(false);
  });

  it("counts each identifier separately", async () => {
    for (let i = 0; i <= ipRule.limit; i++) {
      await enforceRateLimits(db, [{ rule: ipRule, identifier: "a" }], NOW);
    }

    const other = await enforceRateLimits(
      db,
      [{ rule: ipRule, identifier: "b" }],
      NOW,
    );
    expect(other.allowed).toBe(true);
  });

  it("resets in the next window", async () => {
    for (let i = 0; i <= ipRule.limit; i++) {
      await enforceRateLimits(db, [{ rule: ipRule, identifier: "c" }], NOW);
    }

    const nextWindow = new Date(NOW.getTime() + HOUR_MS);
    const after = await enforceRateLimits(
      db,
      [{ rule: ipRule, identifier: "c" }],
      nextWindow,
    );
    expect(after.allowed).toBe(true);
  });

  it("reports which rule tripped", async () => {
    const phoneRule = BOOKING_RULES.phoneDaily;
    for (let i = 0; i < phoneRule.limit; i++) {
      await enforceRateLimits(db, [{ rule: phoneRule, identifier: "p" }], NOW);
    }

    const blocked = await enforceRateLimits(
      db,
      [{ rule: phoneRule, identifier: "p" }],
      NOW,
    );
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.rule.scope).toBe(phoneRule.scope);
      expect(blocked.decision.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("fails open when the store is unreachable", async () => {
    // A booking must not be refused because a counter table is broken.
    const broken = {
      insert: () => {
        throw new Error("connection lost");
      },
    } as unknown as Database;

    const result = await enforceRateLimits(
      broken,
      [{ rule: ipRule, identifier: "x" }],
      NOW,
    );
    expect(result.allowed).toBe(true);
  });

  it("prunes only windows that have expired", async () => {
    await enforceRateLimits(db, [{ rule: ipRule, identifier: "old" }], NOW);

    // One hour later the window above has expired.
    const pruned = await pruneExpiredRateLimits(
      db,
      new Date(NOW.getTime() + 2 * HOUR_MS),
    );
    expect(pruned).toBe(1);

    const remaining = await harness.pg.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM rate_limits",
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  it("keeps a window that is still active", async () => {
    await enforceRateLimits(db, [{ rule: ipRule, identifier: "live" }], NOW);
    expect(await pruneExpiredRateLimits(db, NOW)).toBe(0);
  });
});
