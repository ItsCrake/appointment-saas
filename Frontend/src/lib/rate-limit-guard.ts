import { incrementRateLimit } from "@/db/queries/rate-limits";
import type { Database } from "@/db/types";

import { reportError, reportWarning } from "./observability";
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
        reportWarning("ratelimit.tripped", `${rule.scope} exceeded`, {
          scope: rule.scope,
          count,
          limit: rule.limit,
        });
        return { allowed: false, decision, rule };
      }
    } catch (error) {
      // Deliberately not fatal — see the note above about failing open.
      reportError("ratelimit.unavailable", error, { scope: rule.scope });
    }
  }

  return { allowed: true };
}
