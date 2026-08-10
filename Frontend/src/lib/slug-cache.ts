/**
 * A tiny in-process cache in front of the proxy's "does this slug exist?"
 * lookup.
 *
 * The proxy runs before every public booking page, which is the hottest and
 * most latency-sensitive path in the product. Without a cache each of those
 * requests pays a database round trip to learn something that changes perhaps
 * twice in a tenant's lifetime.
 *
 * **Hits and misses are cached separately, with separate caps and separate
 * lifetimes.** Both halves of that matter:
 *
 * - One shared map would let a bot spraying random slugs evict every real
 *   business from the cache, so the defence against pointless queries would
 *   collapse under exactly the traffic it exists for.
 * - A miss is far more dangerous to hold than a hit. A stale *hit* means a
 *   deactivated shop's page renders and then soft-404s, which is the behaviour
 *   this whole change is replacing — no worse than before. A stale *miss* means
 *   a real, live booking page answers 404 to real clients. So misses expire in
 *   well under a minute and hits live for minutes.
 *
 * Next's proxy docs warn against relying on shared modules or globals, because
 * a proxy can be deployed separately from the app and instances are not
 * coordinated. That is fine here and is why this is a *cache* rather than a
 * store: every entry is derived, expiry is absolute, and a cold or evicted
 * instance simply asks the database again. Nothing is ever only in here.
 */

export type SlugCache = {
  /** `true` / `false` if known and unexpired, `undefined` if it must be looked up. */
  get(slug: string): boolean | undefined;
  set(slug: string, exists: boolean): void;
  /** Forgets one slug — used when a tenant's slug or active flag changes. */
  delete(slug: string): void;
  clear(): void;
  readonly size: number;
};

export type SlugCacheOptions = {
  /** How long a known-good slug is trusted. */
  hitTtlMs?: number;
  /** How long a known-missing slug is trusted. Deliberately much shorter. */
  missTtlMs?: number;
  hitCapacity?: number;
  missCapacity?: number;
  /** Injectable so the tests do not sleep. */
  now?: () => number;
};

export const DEFAULT_HIT_TTL_MS = 5 * 60_000;
/**
 * Short enough that an owner who shares their link the instant they finish
 * setup — after someone had already tried the URL — is not left explaining a
 * 404 to their first client.
 */
export const DEFAULT_MISS_TTL_MS = 20_000;

export function createSlugCache(options: SlugCacheOptions = {}): SlugCache {
  const {
    hitTtlMs = DEFAULT_HIT_TTL_MS,
    missTtlMs = DEFAULT_MISS_TTL_MS,
    hitCapacity = 2_000,
    missCapacity = 500,
    now = Date.now,
  } = options;

  // Insertion-ordered, so the oldest write is always the first key. Reads do
  // not refresh position: expiry already bounds staleness, and promoting on
  // read would only add a way for read traffic to reorder eviction.
  const hits = new Map<string, number>();
  const misses = new Map<string, number>();

  function read(map: Map<string, number>, slug: string): boolean {
    const expiresAt = map.get(slug);
    if (expiresAt === undefined) return false;
    if (expiresAt > now()) return true;
    map.delete(slug);
    return false;
  }

  function write(
    map: Map<string, number>,
    slug: string,
    ttl: number,
    cap: number,
  ) {
    // Re-inserting moves the key to the end, so a refreshed entry is not
    // evicted as though it were the oldest.
    map.delete(slug);
    map.set(slug, now() + ttl);

    while (map.size > cap) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }

  return {
    get(slug) {
      if (read(hits, slug)) return true;
      if (read(misses, slug)) return false;
      return undefined;
    },

    set(slug, exists) {
      if (exists) {
        misses.delete(slug);
        write(hits, slug, hitTtlMs, hitCapacity);
      } else {
        hits.delete(slug);
        write(misses, slug, missTtlMs, missCapacity);
      }
    },

    delete(slug) {
      hits.delete(slug);
      misses.delete(slug);
    },

    clear() {
      hits.clear();
      misses.clear();
    },

    get size() {
      return hits.size + misses.size;
    },
  };
}
