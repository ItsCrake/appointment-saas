import { incrementRateLimit } from "@/db/queries/rate-limits";
import type { Database } from "@/db/types";

import {
  buildRateLimitKey,
  decide,
  type RateLimitDecision,
  type RateLimitRule,
} from "./rate-limit";

export type GuardResult =
  | { allowed: true }
  | { allowed: false; decision: RateLimitDecision; rule: RateLimitRule };

/**
 * Consumes one unit against each rule in turn and reports the first that
 * trips.
 *
 * Fails **open**: if the counter table is unreachable the request proceeds. A
 * booking system that refuses every appointment because a counter is down is
 * worse than the spam it prevents.
 */
export async function enforceRateLimits(
  db: Database,
  checks: { rule: RateLimitRule; identifier: string }[],
  now: Date = new Date(),
): Promise<GuardResult> {
  for (const { rule, identifier } of checks) {
    try {
      const { key, windowStart, expiresAt } = buildRateLimitKey(
        rule,
        identifier,
        now,
      );

      const count = await incrementRateLimit(db, key, windowStart, expiresAt);
      const decision = decide(rule, count, expiresAt, now);

      if (!decision.allowed) {
        console.warn(
          `[rate-limit] ${rule.scope} tripped for "${identifier}" (${count}/${rule.limit})`,
        );
        return { allowed: false, decision, rule };
      }
    } catch (error) {
      console.error(
        `[rate-limit] check failed for ${rule.scope}; allowing through`,
        error,
      );
    }
  }

  return { allowed: true };
}
