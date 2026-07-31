export type RateLimitRule = {
  /** Namespace, e.g. "booking:ip". Part of the storage key. */
  scope: string;
  limit: number;
  windowMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends and the counter resets. */
  resetAt: Date;
  retryAfterSeconds: number;
};

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * Two layers, because they stop different attacks.
 *
 * The IP rules catch hammering from one source. They are deliberately loose:
 * mobile carriers put many real users behind one address, so a tight IP limit
 * blocks genuine clients before it blocks a determined script.
 *
 * The phone rule is the one that actually stops calendar stuffing, since it
 * survives rotating IPs. It is only possible because we hold the domain data.
 */
export const BOOKING_RULES = {
  ipHourly: { scope: "booking:ip:h", limit: 10, windowMs: HOUR_MS },
  ipDaily: { scope: "booking:ip:d", limit: 30, windowMs: DAY_MS },
  phoneDaily: { scope: "booking:phone:d", limit: 5, windowMs: DAY_MS },
} as const satisfies Record<string, RateLimitRule>;

/** Slot lookups are cheap but hammering them is still a DoS vector. */
export const SLOTS_RULE: RateLimitRule = {
  scope: "slots:ip:h",
  limit: 240,
  windowMs: HOUR_MS,
};

/**
 * Deterministic per (rule, identifier, window). Pure, so the window maths is
 * testable without a database.
 */
export function buildRateLimitKey(
  rule: RateLimitRule,
  identifier: string,
  now: Date,
): { key: string; windowStart: Date; expiresAt: Date } {
  const bucket = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs;

  return {
    key: `${rule.scope}:${identifier}:${bucket}`,
    windowStart: new Date(bucket),
    expiresAt: new Date(bucket + rule.windowMs),
  };
}

export function decide(
  rule: RateLimitRule,
  count: number,
  expiresAt: Date,
  now: Date,
): RateLimitDecision {
  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt: expiresAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
    ),
  };
}

/** Hebrew, and specific: a human who hits a limit deserves to know why. */
export function rateLimitMessage(decision: RateLimitDecision): string {
  const minutes = Math.ceil(decision.retryAfterSeconds / 60);

  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `נשלחו יותר מדי בקשות. אפשר לנסות שוב בעוד כ-${hours} שעות, או להתקשר לעסק.`;
  }

  return `נשלחו יותר מדי בקשות. אפשר לנסות שוב בעוד כ-${minutes} דקות, או להתקשר לעסק.`;
}
