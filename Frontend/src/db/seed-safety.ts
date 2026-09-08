/**
 * Whether a seed script may safely create rows that queue messages.
 *
 * ---------------------------------------------------------------------------
 * Its own module, with no imports and no side effects, for one reason: the
 * seeder it guards opens a database connection the moment it is loaded, so a
 * test that imported it to check the refusal would connect to production to
 * assert that a string is right.
 * ---------------------------------------------------------------------------
 */
/**
 * Which guard is suppressing dispatch, or null if none is.
 *
 * ---------------------------------------------------------------------------
 * **Pure and exported so the refusal can be tested without flipping a live kill
 * switch.** The only honest way to check the other branch of
 * {@link assertCannotSend} against the real database would be to turn WhatsApp
 * dispatch *on* for a moment, on production, with a cron running — which is
 * precisely the thing this whole file exists to prevent. So the decision moved
 * out here where it can be exercised in every state, and the caller is left with
 * one query and one throw.
 *
 * Combined by OR, matching `whatsappSuppressionReason` in the dispatcher:
 * either source suppresses and neither can force sending back on. Both are
 * named in the result rather than one of them, because "it was suppressed" is
 * not a useful thing to read later when nobody remembers which switch was on.
 * ---------------------------------------------------------------------------
 */
export function suppressionFrom({
  platformDisabled,
  envValue,
}: {
  platformDisabled: boolean | null;
  envValue: string | undefined;
}): string | null {
  /**
   * Read the way `env.ts` reads it: a value that is not recognisably true does
   * not suppress. `DISABLE_WHATSAPP_DISPATCH=ture` must not read as a guard,
   * because a typo that silently protects nothing is worse than no guard at
   * all — somebody would rely on it.
   */
  const raw = (envValue ?? "").trim().toLowerCase();
  const byEnv = raw === "true" || raw === "1" || raw === "yes";
  const byConsole = platformDisabled === true;

  if (!byEnv && !byConsole) return null;

  return [
    byConsole && "master console toggle",
    byEnv && "DISABLE_WHATSAPP_DISPATCH",
  ]
    .filter(Boolean)
    .join(" + ");
}

/** What the operator is told when neither guard is on. */
export const REFUSAL = [
  "",
  "REFUSING TO SEED: WhatsApp dispatch is not suppressed.",
  "",
  "This script queues a real notification for every appointment it creates,",
  "and it creates a full week of them. With dispatch live that is a few",
  "hundred messages to numbers that never booked anything.",
  "",
  "Turn one of these on first:",
  "  - the master console toggle at /master  (platform_settings), or",
  "  - DISABLE_WHATSAPP_DISPATCH=true in .env.local",
  "",
].join(String.fromCharCode(10));
