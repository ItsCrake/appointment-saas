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

/**
 * Credential endpoints. Tighter than the booking rules, because the thing
 * being protected is an account rather than a calendar.
 *
 * Two identifiers, for the same reason bookings use two: the IP rule stops one
 * host hammering, and the per-identity rule survives a rotating IP pool, which
 * is what a real credential-stuffing run uses. The identity rule is keyed on a
 * *hash* of the email — see `authIdentifier` — so the counter table never
 * becomes a list of who tried to sign in.
 *
 * Sign-up is separate and stricter: a burst of sign-ups from one address is
 * either abuse or a mistake, never a person who forgot their password.
 *
 * **The reset rules protect a different thing.** Sign-in limits exist to make
 * guessing expensive; a reset request cannot be guessed at all — it sends mail
 * to an address the requester may not own. So `resetIdentity` is a *mailbox*
 * defence: without it this app is a free way to drop a password-reset email
 * into someone's inbox on demand, over and over, from an anonymous form. Three
 * an hour is more than a forgetful owner needs and far less than a nuisance
 * campaign wants.
 */
export const AUTH_RULES = {
  signInIp: { scope: "auth:signin:ip", limit: 10, windowMs: 15 * MINUTE_MS },
  signInIdentity: {
    scope: "auth:signin:id",
    limit: 5,
    windowMs: 15 * MINUTE_MS,
  },
  signUpIp: { scope: "auth:signup:ip", limit: 5, windowMs: HOUR_MS },
  resetIp: { scope: "auth:reset:ip", limit: 5, windowMs: HOUR_MS },
  resetIdentity: { scope: "auth:reset:id", limit: 3, windowMs: HOUR_MS },
  /**
   * One request per address per minute, and it exists to **beat Supabase to
   * the refusal**.
   *
   * Supabase applies its own per-address throttle of roughly a minute between
   * recovery emails. When it fires, `resetPasswordForEmail` returns an error
   * and no mail is sent — but the reader had already been told a link was on
   * its way, so the failure was completely silent. That was the reported bug.
   *
   * Refusing here first makes the answer uniform: this counter knows nothing
   * about whether the address is registered, so an unknown address and a real
   * one are throttled identically. Supabase's own throttle could only ever
   * answer for a real one, which is why it must not be the thing the reader
   * hears from.
   */
  resetCooldown: {
    scope: "auth:reset:cooldown",
    limit: 1,
    windowMs: MINUTE_MS,
  },
} as const satisfies Record<string, RateLimitRule>;

/** Slot lookups are cheap but hammering them is still a DoS vector. */
export const SLOTS_RULE: RateLimitRule = {
  scope: "slots:ip:h",
  limit: 240,
  windowMs: HOUR_MS,
};

/**
 * "התורים שלי" — looking a client's own history up by phone number.
 *
 * ---------------------------------------------------------------------------
 * **A phone number is not a credential.** Anyone who knows someone's number can
 * see their name, their services and their times at that business. That is a
 * deliberate product trade-off — an SMS code for a shop with no Twilio account
 * is a feature nobody can use — but it is the reason these limits are the
 * tightest non-auth rules in the file.
 *
 * Two identifiers, as everywhere else here. The IP rule stops one host walking
 * the `05X-XXXXXXX` space; the per-phone rule survives a rotating IP pool and
 * caps how often any single number can be probed from anywhere.
 *
 * The upgrade path when SMS exists is an OTP: same page, one extra step, and
 * the phone stops being the whole answer.
 * ---------------------------------------------------------------------------
 */
export const LOOKUP_RULES = {
  ip: { scope: "lookup:ip:h", limit: 20, windowMs: HOUR_MS },
  phone: { scope: "lookup:phone:h", limit: 5, windowMs: HOUR_MS },
} as const satisfies Record<string, RateLimitRule>;

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
