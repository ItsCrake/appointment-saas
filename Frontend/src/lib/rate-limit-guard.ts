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
 * How long the whole guard may take before it gives up and allows the request.
 *
 * Failing open only helps if it happens *in time*. A pooler that accepts the
 * socket and then stalls produces no error to catch, so the guard would hold
 * the request until the platform's own limit — and a Vercel timeout is an HTML
 * page, which a Server Action caller cannot parse. That is the second route to
 * the `Unexpected token '<'` failure, and the reason this deadline exists:
 * skipping a counter is the outcome this module already accepts, so it may as
 * well be reached deliberately instead of by crashing.
 */
const GUARD_BUDGET_MS = 3_000;

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Consumes one unit against each rule in turn and reports the first that
 * trips.
 *
 * Fails **open**: if the counter table is unreachable, or merely too slow, the
 * request proceeds. A booking system that refuses every appointment because a
 * counter is down is worse than the spam it prevents — and an auth form that
 * cannot be submitted because a counter is down is worse still.
 */
export async function enforceRateLimits(
  db: Database,
  checks: { rule: RateLimitRule; identifier: string }[],
  now: Date = new Date(),
): Promise<GuardResult> {
  const deadline = Date.now() + GUARD_BUDGET_MS;

  for (const { rule, identifier } of checks) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reportError(
        "ratelimit.unavailable",
        new Error("guard budget exhausted"),
        {
          scope: rule.scope,
        },
      );
      break;
    }

    try {
      const { key, windowStart, expiresAt } = buildRateLimitKey(
        rule,
        identifier,
        now,
      );

      const count = await withDeadline(
        incrementRateLimit(db, key, windowStart, expiresAt),
        remaining,
      );

      // Null means the write threw or outran the budget. Either way the
      // counter is unusable for this request, and the rule is skipped.
      if (count === null) {
        reportError("ratelimit.unavailable", new Error("counter unavailable"), {
          scope: rule.scope,
        });
        continue;
      }

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
