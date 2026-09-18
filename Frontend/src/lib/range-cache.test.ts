import { describe, expect, it, vi } from "vitest";

import { createRangeCache, fetchDashboardJson } from "./range-cache";

/**
 * The memory that makes stepping through the calendar instant.
 *
 * Everything the calendar promises about live data is a rule here — shown from
 * memory but refreshed, never passing an old fetch off as fresh after a write,
 * and bounded — so each rule is pinned on its own, with an injected clock and
 * a fetcher that answers when the test says so.
 */

/** A fetcher whose answers the test releases by hand. */
function deferredFetcher() {
  const calls: { key: string; resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  const fetcher = vi.fn(
    (key: string) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ key, resolve, reject });
      }),
  );
  return { fetcher, calls };
}

describe("createRangeCache", () => {
  it("fetches a range once, however many ask at the same time", async () => {
    const { fetcher, calls } = deferredFetcher();
    const cache = createRangeCache(fetcher);

    const first = cache.load("w1");
    const second = cache.load("w1");
    cache.prefetch("w1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.isLoading("w1")).toBe(true);

    calls[0].resolve("week one");
    await expect(first).resolves.toBe("week one");
    await expect(second).resolves.toBe("week one");
    expect(cache.isLoading("w1")).toBe(false);
    expect(cache.peek("w1")).toBe("week one");
  });

  it("answers from memory while the copy is young enough, and fetches after", async () => {
    let clock = 1_000;
    const fetcher = vi.fn(async (key: string) => `${key}@${clock}`);
    const cache = createRangeCache(fetcher, { now: () => clock });

    await cache.load("w1", 10_000);
    clock += 5_000;
    await expect(cache.load("w1", 10_000)).resolves.toBe("w1@1000");
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 6_000;
    await expect(cache.load("w1", 10_000)).resolves.toBe("w1@12000");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps showing an old copy while its refresh is on the way", async () => {
    const { fetcher, calls } = deferredFetcher();
    const cache = createRangeCache(fetcher);

    cache.put("w1", "as it was");
    cache.invalidate();
    const refreshed = cache.load("w1", 10_000);

    // A slightly old week is a better thing to look at than a blank one.
    expect(cache.peek("w1")).toBe("as it was");
    calls[0].resolve("as it is");
    await refreshed;
    expect(cache.peek("w1")).toBe("as it is");
  });

  it("never counts a fetch that spanned a write as fresh", async () => {
    const { fetcher, calls } = deferredFetcher();
    const cache = createRangeCache(fetcher);

    // A prefetch starts, then the owner moves a booking before it lands.
    cache.prefetch("w2", 60_000);
    cache.invalidate();
    calls[0].resolve("from before the move");
    await Promise.resolve();
    await Promise.resolve();

    // Kept for display, but the next look asks again.
    expect(cache.peek("w2")).toBe("from before the move");
    const again = cache.load("w2", 60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    calls[1].resolve("after the move");
    await expect(again).resolves.toBe("after the move");
  });

  it("marks everything stale on a write without dropping it", async () => {
    const fetcher = vi.fn(async (key: string) => `${key} fetched`);
    const cache = createRangeCache(fetcher);

    cache.put("w1", "held one");
    cache.put("w2", "held two");
    cache.invalidate();

    expect(cache.peek("w1")).toBe("held one");
    expect(cache.peek("w2")).toBe("held two");
    await cache.load("w1", 60_000);
    expect(fetcher).toHaveBeenCalledWith("w1");
  });

  it("forgets a failed fetch so the next look tries again", async () => {
    const { fetcher, calls } = deferredFetcher();
    const cache = createRangeCache(fetcher);

    const failing = cache.load("w1");
    calls[0].reject(new Error("offline"));
    await expect(failing).rejects.toThrow("offline");
    expect(cache.isLoading("w1")).toBe(false);
    expect(cache.peek("w1")).toBeUndefined();

    const retry = cache.load("w1");
    expect(fetcher).toHaveBeenCalledTimes(2);
    calls[1].resolve("back online");
    await expect(retry).resolves.toBe("back online");
  });

  it("swallows a failed prefetch — nobody is looking at that range yet", async () => {
    const { calls, fetcher } = deferredFetcher();
    const cache = createRangeCache(fetcher);

    cache.prefetch("w9");
    calls[0].reject(new Error("offline"));
    // An unhandled rejection would fail this test run.
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.peek("w9")).toBeUndefined();
  });

  it("holds a bounded number of ranges, dropping the least recently stored", () => {
    const cache = createRangeCache(async () => "", { maxEntries: 3 });

    cache.put("a", "A");
    cache.put("b", "B");
    cache.put("c", "C");
    cache.put("a", "A again");
    cache.put("d", "D");

    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBe("A again");
    expect(cache.peek("c")).toBe("C");
    expect(cache.peek("d")).toBe("D");
  });

  it("tells subscribers about every change, with a version that moves", async () => {
    const cache = createRangeCache(async (key) => key);
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    const before = cache.version();

    cache.put("w1", "one");
    await cache.load("w2");
    cache.invalidate();

    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(cache.version()).toBeGreaterThan(before);

    unsubscribe();
    listener.mockClear();
    cache.put("w3", "three");
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps each tenant's ranges apart by key", async () => {
    // The calendar keys by `${tenant}|${week}`: an administrator supporting
    // two shops in one tab must never see one shop's week under the other.
    const cache = createRangeCache(async (key) => key);

    await cache.load("shop-a|2026-09-13");
    expect(cache.peek("shop-b|2026-09-13")).toBeUndefined();
  });
});

describe("fetchDashboardJson", () => {
  it("returns the JSON of a successful dashboard read", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), {
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    try {
      await expect(fetchDashboardJson("/api/dashboard/week")).resolves.toEqual({
        ok: 1,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/dashboard/week", {
        cache: "no-store",
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses an answer that is not JSON — an ended session's login page", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
      }),
    ) as typeof fetch;

    try {
      await expect(fetchDashboardJson("/api/dashboard/week")).rejects.toThrow();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("refuses an error status", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "bad_week" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    try {
      await expect(fetchDashboardJson("/api/dashboard/week")).rejects.toThrow(
        "400",
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
