import { describe, expect, it } from "vitest";

import { createSlugCache } from "./slug-cache";

/**
 * The cache sits in front of every public booking page render, so its failure
 * modes are asymmetric and the tests are shaped around that: a stale hit is a
 * cosmetic regression, a stale miss takes a live business offline, and an
 * unbounded map is a memory leak a bot can drive.
 */

function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

describe("slug cache", () => {
  it("does not answer for a slug it has never seen", () => {
    expect(createSlugCache().get("demo-barber")).toBeUndefined();
  });

  it("remembers both answers", () => {
    const cache = createSlugCache();
    cache.set("real-shop", true);
    cache.set("ghost-shop", false);

    expect(cache.get("real-shop")).toBe(true);
    expect(cache.get("ghost-shop")).toBe(false);
  });

  it("expires a hit after its TTL", () => {
    const time = clock();
    const cache = createSlugCache({ hitTtlMs: 1_000, now: time.now });
    cache.set("real-shop", true);

    time.advance(999);
    expect(cache.get("real-shop")).toBe(true);

    time.advance(2);
    expect(cache.get("real-shop")).toBeUndefined();
  });

  it("expires a miss much sooner than a hit", () => {
    // The asymmetry is the safety property, not a tuning detail: a stale miss
    // 404s a real booking page, a stale hit only reproduces the soft 404 this
    // guard replaced. A future edit that equalises them should fail here.
    const time = clock();
    const cache = createSlugCache({
      hitTtlMs: 10_000,
      missTtlMs: 1_000,
      now: time.now,
    });

    cache.set("real-shop", true);
    cache.set("ghost-shop", false);

    time.advance(1_001);
    expect(cache.get("ghost-shop")).toBeUndefined();
    expect(cache.get("real-shop")).toBe(true);
  });

  it("lets a new business overwrite the miss recorded before it existed", () => {
    const cache = createSlugCache();
    cache.set("brand-new", false);
    cache.set("brand-new", true);

    expect(cache.get("brand-new")).toBe(true);
  });

  it("lets a deactivated business overwrite its own hit", () => {
    const cache = createSlugCache();
    cache.set("closing-down", true);
    cache.set("closing-down", false);

    expect(cache.get("closing-down")).toBe(false);
  });

  it("forgets a slug on demand", () => {
    const cache = createSlugCache();
    cache.set("real-shop", true);
    cache.delete("real-shop");

    expect(cache.get("real-shop")).toBeUndefined();
  });

  it("bounds each half independently", () => {
    const cache = createSlugCache({ hitCapacity: 2, missCapacity: 2 });

    for (let i = 0; i < 50; i++) cache.set(`hit-${i}`, true);
    for (let i = 0; i < 50; i++) cache.set(`miss-${i}`, false);

    expect(cache.size).toBe(4);
  });

  it("never lets a spray of misses evict a real business", () => {
    // This is why hits and misses are separate maps. In one shared map, a bot
    // walking random slugs would flush every live shop out of the cache — so
    // the defence against pointless queries would collapse under exactly the
    // traffic it exists for.
    const cache = createSlugCache({ hitCapacity: 10, missCapacity: 5 });
    cache.set("real-shop", true);

    for (let i = 0; i < 1_000; i++) cache.set(`probe-${i}`, false);

    expect(cache.get("real-shop")).toBe(true);
    expect(cache.size).toBeLessThanOrEqual(6);
  });

  it("evicts the oldest write first", () => {
    const cache = createSlugCache({ hitCapacity: 2 });
    cache.set("first", true);
    cache.set("second", true);
    cache.set("third", true);

    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBe(true);
    expect(cache.get("third")).toBe(true);
  });

  it("refreshing an entry moves it off the eviction line", () => {
    const cache = createSlugCache({ hitCapacity: 2 });
    cache.set("first", true);
    cache.set("second", true);
    cache.set("first", true); // re-verified against the database
    cache.set("third", true);

    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("first")).toBe(true);
  });
});
