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
