/**
 * What was said a moment ago, so "תזיז אותו" has something to point at.
 *
 * ---------------------------------------------------------------------------
 * **The endpoint is still stateless; the conversation rides with the request.**
 * The same shape the pending action already uses, and for the same reason: a
 * server-side store for something that lives ninety seconds would be a second
 * lifetime to manage, a second thing to expire, and a second thing to get wrong
 * in a serverless deploy where the next turn is a different instance.
 *
 * **It arrives from the browser, so it is data and not evidence.** A caller can
 * put anything in it. That is bounded rather than prevented, and the reason it
 * is safe to bound rather than prevent is where the authority actually lives:
 * every tool resolves ids under the signed-in tenant, `executePending` re-reads
 * the row before writing, and the confirmation gate reads the *current*
 * transcript through a word list that never sees this. A forged history can
 * make ליבי say something odd. It cannot make her touch another shop's diary,
 * and it cannot confirm anything — the caller is the owner, who could simply
 * have said the thing out loud instead.
 *
 * **The roster stays the source of truth about the diary.** History is context
 * for *reference*, not for fact: the prompt still carries today's date and the
 * week's bookings, freshly read, on every single turn. So a stale sentence in
 * here cannot outvote the database — at worst the model resolves "אותו" to an
 * appointment that has since moved, and the tool it then calls looks the name
 * up again anyway.
 * ---------------------------------------------------------------------------
 */

/** One exchange: what the owner said, and what ליבי answered. */
export type Turn = {
  /** The transcript, as Whisper heard it. */
  said: string;
  /** The sentence she spoke back. */
  replied: string;
  /** When the turn happened, epoch ms. */
  at: number;
};

/**
 * How many exchanges travel with a request.
 *
 * Six is two or three complete thoughts — "what's next", "move it", "no, the
 * other one" — which is the span over which a pronoun still refers to
 * something. Past that it is prompt weight on every turn for context nobody is
 * still holding, and this is a request somebody is standing still through.
 */
export const MAX_TURNS = 6;

/**
 * How old an exchange may be and still be context.
 *
 * A tab left open over lunch and picked up again is a new conversation, and
 * "תבטל אותו" resolved against a sentence from two hours ago is worse than not
 * resolved at all. Fifteen minutes is far longer than any real exchange and far
 * shorter than "later".
 */
export const MAX_TURN_AGE_MS = 15 * 60 * 1000;

/**
 * A hard ceiling on what one turn can carry, whatever the counts say.
 *
 * The list above bounds *turns*; this bounds bytes, because a turn is only
 * short by convention — the transcript is whatever Whisper returned for twenty
 * seconds of audio, and a crafted request is not bound by convention at all.
 */
const MAX_CHARS = 300;

/**
 * The history a request may use: recent, bounded, and trimmed.
 *
 * Oldest are dropped rather than newest — a pronoun points backwards a little,
 * not a lot, so the last thing said is the part worth keeping.
 */
export function boundHistory(turns: readonly Turn[], now: number): Turn[] {
  return turns
    .filter((turn) => now - turn.at <= MAX_TURN_AGE_MS && now - turn.at >= 0)
    .slice(-MAX_TURNS)
    .map((turn) => ({
      said: turn.said.slice(0, MAX_CHARS),
      replied: turn.replied.slice(0, MAX_CHARS),
      at: turn.at,
    }));
}

/**
 * Shape-checks what the client sent.
 *
 * Anything malformed is dropped **whole** rather than partially repaired: a
 * half-parsed conversation is a conversation with a gap in it, and a gap is
 * exactly where a pronoun resolves to the wrong thing.
 */
export function parseHistory(raw: unknown, now: number): Turn[] {
  if (typeof raw !== "string" || !raw) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(value)) return [];

  const turns: Turn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return [];
    const turn = entry as Record<string, unknown>;
    if (
      typeof turn.said !== "string" ||
      typeof turn.replied !== "string" ||
      typeof turn.at !== "number" ||
      !Number.isFinite(turn.at)
    ) {
      return [];
    }
    turns.push({ said: turn.said, replied: turn.replied, at: turn.at });
  }

  return boundHistory(turns, now);
}

/** The chat messages a bounded history becomes, oldest first. */
export function historyMessages(
  turns: readonly Turn[],
): { role: "user" | "assistant"; content: string }[] {
  return turns.flatMap((turn) => [
    { role: "user" as const, content: turn.said },
    { role: "assistant" as const, content: turn.replied },
  ]);
}
