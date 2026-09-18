/**
 * The dashboard's memory of the days and weeks it has already fetched.
 *
 * ---------------------------------------------------------------------------
 * **What makes stepping through the calendar instant.** The agenda and the
 * full calendar used to change day or week by navigating, and every step waited
 * on the server — 2.1–2.9s on a production build — behind a skeleton that
 * replaced the whole page. They now switch in their own state and read the
 * range from here: already in memory when it was prefetched, shown at once
 * when it was seen before, and fetched only when it is genuinely new.
 *
 * Three rules, each of which exists because the calendar is live data:
 *
 * 1. **Shown from memory, refreshed behind it.** A range older than the
 *    caller's `maxAgeMs` is still returned by `peek` — a slightly old week is a
 *    better thing to look at than a blank one — while `load` fetches it again.
 * 2. **A write makes everything suspect.** `invalidate` marks every range
 *    stale without dropping it, and bumps a generation: a fetch that was
 *    already in flight when the write happened lands as *stale*, so a prefetch
 *    begun a second before a move can never pass itself off as the week after
 *    it.
 * 3. **Bounded.** Twelve ranges is a quarter's worth of weeks; past that the
 *    least recently stored goes, so an afternoon of browsing cannot grow
 *    without limit.
 *
 * Pure apart from the fetcher and the clock, both injected, so it is tested
 * without a network or a browser.
 * ---------------------------------------------------------------------------
 */

type Slot<T> = {
  value?: T;
  /** When the value was stored; 0 once it has been invalidated. */
  at: number;
  /** The generation the value was fetched in. */
  gen: number;
  pending?: Promise<T>;
};

export type RangeCache<T> = {
  /** The stored value, fresh or not, without fetching. */
  peek(key: string): T | undefined;
  /** Whether a fetch for this key is in flight. */
  isLoading(key: string): boolean;
  /**
   * The value, fetched only if it is missing or older than `maxAgeMs`.
   * Concurrent calls share one request.
   */
  load(key: string, maxAgeMs?: number): Promise<T>;
  /** `load` for a range nobody is looking at yet; failures are ignored. */
  prefetch(key: string, maxAgeMs?: number): void;
  /** Stores a value obtained elsewhere — the server's own render of a range. */
  put(key: string, value: T): void;
  /** Marks everything stale — see rule 2. */
  invalidate(): void;
  subscribe(listener: () => void): () => void;
  /** Changes whenever anything a subscriber could read changes. */
  version(): number;
};

export function createRangeCache<T>(
  fetcher: (key: string) => Promise<T>,
  { now = Date.now, maxEntries = 12 }: { now?: () => number; maxEntries?: number } = {},
): RangeCache<T> {
  const slots = new Map<string, Slot<T>>();
  const listeners = new Set<() => void>();
  let generation = 0;
  let version = 0;

  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  /** Re-inserts on write, so Map order is least recently stored first. */
  const store = (key: string, slot: Slot<T>) => {
    slots.delete(key);
    slots.set(key, slot);
    while (slots.size > maxEntries) {
      const oldest = slots.keys().next().value as string;
      slots.delete(oldest);
    }
  };

  const fresh = (slot: Slot<T> | undefined, maxAgeMs: number) =>
    Boolean(
      slot?.value !== undefined &&
        slot.gen === generation &&
        slot.at > 0 &&
        now() - slot.at < maxAgeMs,
    );

  const load = (key: string, maxAgeMs = 0): Promise<T> => {
    const slot = slots.get(key);
    if (slot?.pending) return slot.pending;
    if (fresh(slot, maxAgeMs)) return Promise.resolve(slot!.value as T);

    const startedIn = generation;
    const pending = fetcher(key).then(
      (value) => {
        // Fetched across a write: kept for display, but never counted fresh.
        const current = startedIn === generation;
        store(key, { value, at: current ? now() : 0, gen: startedIn });
        notify();
        return value;
      },
      (error: unknown) => {
        const failed = slots.get(key);
        if (failed) store(key, { ...failed, pending: undefined });
        notify();
        throw error;
      },
    );

    store(key, { ...(slot ?? { at: 0, gen: generation }), pending });
    notify();
    return pending;
  };

  return {
    peek: (key) => slots.get(key)?.value,
    isLoading: (key) => Boolean(slots.get(key)?.pending),
    load,
    prefetch(key, maxAgeMs) {
      load(key, maxAgeMs).catch(() => {});
    },
    put(key, value) {
      store(key, { value, at: now(), gen: generation });
      notify();
    },
    invalidate() {
      generation += 1;
      for (const [key, slot] of slots) {
        slots.set(key, { ...slot, at: 0 });
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}

/**
 * The JSON of a dashboard endpoint, or an error that says to navigate instead.
 *
 * A session that ended mid-afternoon answers with a redirect to the login page
 * — HTML, not JSON — and that is not a range to cache but a reason to let a
 * real navigation happen, so the caller can show the owner where they are.
 */
export async function fetchDashboardJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("application/json")) {
    throw new Error(`dashboard fetch failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
