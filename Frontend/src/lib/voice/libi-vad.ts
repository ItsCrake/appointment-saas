/**
 * Deciding when the owner has stopped talking.
 *
 * ---------------------------------------------------------------------------
 * Pure, and separated from the component for the usual reason: the arithmetic
 * is the part that can be quietly wrong. A level reduced incorrectly, or a
 * latch that lets the timer run before anybody has spoken, produces a
 * microphone that closes half a second after it opens — and the symptom is an
 * empty transcript, which looks like a Whisper problem rather than a maths one.
 *
 * The component owns the `AnalyserNode` and the animation frame; this owns what
 * the numbers mean.
 * ---------------------------------------------------------------------------
 */

/**
 * How long a pause has to last before it counts as "finished speaking".
 *
 * 1.8s is long enough to survive the gap between clauses and short enough that
 * the answer still feels like a reply rather than a form submission.
 */
export const SILENCE_MS = 1800;

/**
 * The RMS level above which the microphone is hearing a voice rather than a
 * room.
 *
 * A shop is not a quiet place: clippers, a radio, the street. Too low and the
 * silence timer never fires, so every recording runs to the cap; too high and a
 * softly spoken question never registers. 0.025 sits above a typical room floor
 * and below ordinary speech — and {@link decideSilence}'s latch is what makes
 * the choice forgiving, since the worst case of a too-high threshold is the old
 * fixed-duration behaviour rather than a truncated question.
 */
export const SPEECH_RMS = 0.025;

/**
 * The loudness of one analyser frame, 0…1.
 *
 * `getByteTimeDomainData` centres silence on 128, so the deviation from that —
 * not the raw value — is the signal. Root-mean-square rather than a peak,
 * because a single click should not read as a sentence.
 */
export function frameLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;

  let sum = 0;
  for (const value of samples) {
    const deviation = (value - 128) / 128;
    sum += deviation * deviation;
  }
  return Math.sqrt(sum / samples.length);
}

export type SilenceState = {
  /** Whether the level has ever crossed the threshold this turn. */
  spoke: boolean;
  /** When the current quiet spell began, or 0 while there is sound. */
  quietSince: number;
};

export const INITIAL_SILENCE_STATE: SilenceState = {
  spoke: false,
  quietSince: 0,
};

/**
 * How long a re-opened microphone waits for the owner to say anything at all.
 *
 * ---------------------------------------------------------------------------
 * **This exists because {@link decideSilence}'s latch is a one-way door.**
 * Nothing may auto-stop until somebody has spoken, which is exactly right when
 * the owner pressed the button — they meant to talk, and cutting them off while
 * they think is the worst thing this component can do.
 *
 * It is exactly wrong when the microphone re-opened *on its own* after ליבי
 * finished answering. Nobody asked for that turn, so nobody may be about to use
 * it, and the latch would hold the recording open to the twenty-second cap and
 * then send twenty seconds of shop noise to Whisper — a bill, a wasted model
 * call, and "לא שמעתי כלום" said to a room.
 *
 * Seven seconds: long enough to think of a follow-up while looking at the
 * calendar, short enough that a conversation nobody continued closes while the
 * owner is still in front of the screen to see it close.
 * ---------------------------------------------------------------------------
 */
export const IDLE_MS = 7000;

/**
 * Whether a turn should be abandoned because nobody has spoken into it.
 *
 * Deliberately **not** folded into `decideSilence`: that answers "has this
 * sentence finished", and its answer feeds a send. This answers "was there a
 * sentence at all", and its answer feeds a discard. Two questions with two
 * different consequences, kept apart so neither can be mistaken for the other.
 *
 * `elapsedMs` is measured from when the microphone opened, not from the start
 * of the conversation.
 */
export function decideIdle(
  state: SilenceState,
  elapsedMs: number,
  idleMs = IDLE_MS,
): boolean {
  // Once anybody has spoken this never fires again, and `decideSilence` owns
  // the rest of the turn.
  return !state.spoke && elapsedMs >= idleMs;
}

/**
 * One frame's worth of decision.
 *
 * **The latch is the whole point.** Nothing may stop the recording until the
 * level has been over the line at least once: without it, a quiet room means
 * the timer starts at frame one and the microphone closes 1.8 seconds later,
 * before the owner has drawn breath. With it, somebody who taps and thinks for
 * five seconds still gets to ask their question.
 *
 * Returns the next state and whether to stop, rather than mutating or calling
 * back — which is what makes the sequence testable without an audio graph.
 */
export function decideSilence(
  state: SilenceState,
  level: number,
  now: number,
  silenceMs = SILENCE_MS,
): { state: SilenceState; stop: boolean } {
  if (level > SPEECH_RMS) {
    // Sound resets the pause; a gap between two clauses is not the end.
    return { state: { spoke: true, quietSince: 0 }, stop: false };
  }

  if (!state.spoke) return { state, stop: false };

  const quietSince = state.quietSince === 0 ? now : state.quietSince;
  return {
    state: { spoke: true, quietSince },
    stop: now - quietSince >= silenceMs,
  };
}
