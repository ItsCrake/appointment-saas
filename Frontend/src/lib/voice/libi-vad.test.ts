import { describe, expect, it } from "vitest";

import {
  decideSilence,
  frameLevel,
  INITIAL_SILENCE_STATE,
  SILENCE_MS,
  SPEECH_RMS,
} from "./libi-vad";

/**
 * When the microphone decides you have finished.
 *
 * ---------------------------------------------------------------------------
 * Every failure here is silent in the literal sense. A latch that lets the
 * timer run before anybody has spoken closes the microphone half a second after
 * it opens, and the owner gets "לא שמעתי כלום" for a question they asked
 * perfectly clearly — which reads as a Whisper problem, or as the feature being
 * broken, rather than as a comparison in the wrong order.
 * ---------------------------------------------------------------------------
 */

/** An analyser frame at a given amplitude, centred on 128 like the real one. */
const frame = (amplitude: number, length = 512): Uint8Array =>
  Uint8Array.from({ length }, (_, i) =>
    Math.round(128 + Math.sin((i / length) * Math.PI * 8) * amplitude * 127),
  );

describe("frameLevel", () => {
  it("reads silence as zero", () => {
    // 128 is the centre, not the floor — subtracting the wrong constant is the
    // classic version of this bug and would make silence read as full volume.
    expect(frameLevel(new Uint8Array(512).fill(128))).toBe(0);
  });

  it("rises with amplitude", () => {
    const quiet = frameLevel(frame(0.01));
    const loud = frameLevel(frame(0.6));
    expect(quiet).toBeLessThan(SPEECH_RMS);
    expect(loud).toBeGreaterThan(SPEECH_RMS);
    expect(loud).toBeGreaterThan(quiet);
  });

  it("never exceeds one, however loud", () => {
    expect(frameLevel(frame(1))).toBeLessThanOrEqual(1);
  });

  it("survives an empty frame", () => {
    // Belt and braces: an analyser handed a zero-length array should not make
    // the caller divide by nothing.
    expect(frameLevel(new Uint8Array(0))).toBe(0);
  });
});

describe("decideSilence", () => {
  it("never stops before anybody has spoken", () => {
    /**
     * The assertion this module exists for. An owner who taps the microphone
     * and then thinks for five seconds must still get to ask their question.
     */
    let state = INITIAL_SILENCE_STATE;
    for (let t = 0; t < 10_000; t += 16) {
      const next = decideSilence(state, 0, t);
      expect(next.stop, `stopped at ${t}ms without speech`).toBe(false);
      state = next.state;
    }
  });

  it("stops once the pause reaches the threshold", () => {
    const spoke = decideSilence(INITIAL_SILENCE_STATE, 0.4, 0);
    expect(spoke.state.spoke).toBe(true);

    /**
     * **The clock starts when the silence does, not when the turn does.** The
     * first quiet frame here is at 100ms, so the threshold is reached at
     * 1900ms — which is what the live run measured: a 1.54s utterance stopped
     * the recording at 3.337s, exactly 1.800s after the speech ended.
     */
    const began = decideSilence(spoke.state, 0, 100);
    expect(began.stop).toBe(false);
    expect(began.state.quietSince).toBe(100);

    expect(decideSilence(began.state, 0, 100 + SILENCE_MS - 1).stop).toBe(false);
    expect(decideSilence(began.state, 0, 100 + SILENCE_MS).stop).toBe(true);
  });

  it("treats a gap between clauses as part of the sentence", () => {
    /**
     * Hebrew speakers pause mid-sentence like everyone else. A gap shorter than
     * the threshold has to reset the clock completely — otherwise two half-long
     * pauses would add up and cut somebody off mid-question.
     */
    let outcome = decideSilence(INITIAL_SILENCE_STATE, 0.4, 0);
    outcome = decideSilence(outcome.state, 0, 1000); // a second of thought
    expect(outcome.stop).toBe(false);

    outcome = decideSilence(outcome.state, 0.4, 1200); // speaking again
    expect(outcome.state.quietSince).toBe(0);

    // The clock restarts from here, so the earlier pause buys nothing.
    outcome = decideSilence(outcome.state, 0, 1200 + SILENCE_MS - 1);
    expect(outcome.stop).toBe(false);
  });

  it("measures from the start of the pause, not from each frame", () => {
    // Sampled ~60 times a second, so the state has to carry the start; a
    // per-frame comparison would never accumulate and would never fire.
    let outcome = decideSilence(INITIAL_SILENCE_STATE, 0.4, 0);
    let stopped = false;
    for (let t = 16; t <= 4000 && !stopped; t += 16) {
      outcome = decideSilence(outcome.state, 0, t);
      stopped = outcome.stop;
      if (stopped) {
        // Fires as soon as the threshold is crossed, within one frame of it.
        expect(t).toBeGreaterThanOrEqual(SILENCE_MS);
        expect(t).toBeLessThan(SILENCE_MS + 32);
      }
    }
    expect(stopped, "never stopped across four seconds of silence").toBe(true);
  });

  it("holds the threshold the browser check measured", () => {
    // A live run against a 1.54s utterance stopped the recording at 3.337s —
    // 1.800s after the speech ended. That number is this constant.
    expect(SILENCE_MS).toBe(1800);
  });
});
