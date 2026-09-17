import { describe, expect, it } from "vitest";

import {
  decideSilence,
  frameFeatures,
  frameSize,
  IDLE_MS,
  idleOutcome,
  initialSilenceState,
  INITIAL_SILENCE_STATE,
  NOISY_SILENCE_MS,
  PRESSED_IDLE_MS,
  SHORT_SILENCE_MS,
  SHORT_VOICE_MS,
  SILENCE_MS,
  VAD_TUNING,
  type SilenceState,
} from "./libi-vad";

/**
 * When the microphone decides you have started, and finished — in a shop.
 *
 * ---------------------------------------------------------------------------
 * Every failure here is silent in the literal sense. A latch that lets the
 * clock run before anybody has spoken closes the microphone half a second after
 * it opens; a threshold the room can cross holds it open to the cap and sends
 * the radio to the transcriber. Both read as "the assistant is broken" rather
 * than as a comparison in the wrong place.
 *
 * **What the tuning was held to.** `VAD_TUNING` was set by running this module
 * frame by frame at 48kHz over the sixteen spoken commands from the
 * transcription benchmark (two voices, eight commands), each followed by six
 * seconds more of the same noise:
 *
 * | condition                 | turn ended after the words | old detector |
 * | ------------------------- | -------------------------- | ------------ |
 * | clean                     | 16/16                      | 16/16        |
 * | clippers, voice +10dB     | 16/16                      | 0/16 (cap)   |
 * | clippers, voice +3dB      | 14/16                      | 0/16 (cap)   |
 * | music with melody, +6dB   | 16/16                      | 0/16 (cap)   |
 * | music as loud as the voice| 7/16                       | 0/16 (cap)   |
 *
 * The pause that ends a turn is 1.4s in a quiet room and 1.8s in a loud one;
 * with 1.4s everywhere, the +3dB and +6dB rows fell to 13/16 each. The same
 * results at 44.1kHz and 16kHz within a clip or two. Noise alone never
 * latched, except when a quiet room was seeded and music then started — which
 * ends by itself in under seven seconds rather than running to the cap. The
 * signals below are synthetic stand-ins for those cases, small enough to run on
 * every commit; the recordings live outside the repository.
 * ---------------------------------------------------------------------------
 */

const RATE = 16_000;
const FRAME_MS = 1000 / 60;
const BUFFER = 2048;

/** A deterministic generator, so a failure reproduces. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A voiced sound: a comb of harmonics over a wandering pitch, spoken in
 * syllables — loud vowels with short dips between them, like a sentence.
 */
function voice(ms: number, amplitude: number): Float32Array {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f0 = 140 + 25 * Math.sin(2 * Math.PI * 1.3 * t);
    phase += (2 * Math.PI * f0) / RATE;
    let v = 0;
    for (let k = 1; k * f0 < 3600; k++) v += Math.sin(k * phase) / k;
    // ~4 syllables a second, each dipping to a fifth between vowels.
    const syllable = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    out[i] = amplitude * 0.4 * v * syllable;
  }
  return out;
}

/** Broadband hiss: a clipper's blade, a fan, the street. */
function hiss(ms: number, amplitude: number, seed = 1): Float32Array {
  const random = prng(seed);
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * (random() * 2 - 1);
  return out;
}

/** A clipper: hiss plus a buzzing motor, wobbling as it moves around a head. */
function clippers(ms: number, amplitude: number, seed = 2): Float32Array {
  const noise = hiss(ms, 1, seed);
  const out = new Float32Array(noise.length);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const wobble = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.7 * t);
    let buzz = 0;
    for (const k of [1, 2, 3, 5, 7]) {
      buzz += Math.sin(2 * Math.PI * 120 * k * t) / k;
    }
    out[i] = amplitude * wobble * (0.8 * noise[i] + 0.3 * buzz);
  }
  return out;
}

const silence = (ms: number) =>
  new Float32Array(Math.round((ms / 1000) * RATE));

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** Feeds a signal to the detector the way the component does: 60 frames a second. */
function run(
  signal: Float32Array,
  { seed, idleMs }: { seed?: number; idleMs?: number } = {},
) {
  let state: SilenceState = initialSilenceState(seed);
  let latchedAt: number | null = null;
  const total = (signal.length / RATE) * 1000;

  for (let t = FRAME_MS; t <= total; t += FRAME_MS) {
    const end = Math.floor((t / 1000) * RATE);
    const frame = new Float32Array(BUFFER);
    const start = Math.max(0, end - BUFFER);
    frame.set(signal.subarray(start, end), BUFFER - (end - start));

    const outcome = decideSilence(state, frameFeatures(frame, RATE), t);
    state = outcome.state;
    if (state.spoke && latchedAt === null) latchedAt = t;
    if (outcome.stop) return { stoppedAt: t, latchedAt, idle: null, state };

    if (idleMs !== undefined) {
      const idle = idleOutcome(state, t, idleMs);
      if (idle !== "wait") return { stoppedAt: t, latchedAt, idle, state };
    }
  }

  return { stoppedAt: null, latchedAt, idle: null, state };
}

const sine = (hz: number, amplitude: number, rate = RATE, length = BUFFER) =>
  Float32Array.from(
    { length },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
  );

describe("frameFeatures", () => {
  it("reads silence as nothing, and flat", () => {
    expect(frameFeatures(new Float32Array(BUFFER), RATE)).toEqual({
      level: 0,
      flatness: 1,
    });
  });

  it("reads a tone inside the voice band as its RMS", () => {
    // Parseval over the band, normalised by the window: a sine of amplitude
    // 0.5 has an RMS of ~0.354, and the band level must agree with it.
    const { level } = frameFeatures(sine(1000, 0.5), RATE);
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(0.4);
  });

  it("barely hears a hum below the band or a hiss above it", () => {
    /**
     * The point of measuring the band at all. A clipper's motor and a radio's
     * bass are most of their energy, and none of it is a voice.
     */
    const inBand = frameFeatures(sine(1000, 0.5), RATE).level;
    expect(frameFeatures(sine(90, 0.5), RATE).level).toBeLessThan(inBand / 10);
    expect(frameFeatures(sine(6000, 0.5), RATE).level).toBeLessThan(
      inBand / 10,
    );
  });

  it("tells a voiced sound from hiss by its shape", () => {
    // A comb of harmonics is peaked; noise is flat. Only the onset uses this,
    // so a fricative mid-word cannot end a sentence.
    const voiced = frameFeatures(voice(200, 0.5).subarray(-BUFFER), RATE);
    const noise = frameFeatures(hiss(200, 0.5), RATE);
    expect(voiced.flatness).toBeLessThan(VAD_TUNING.maxOnsetFlatness);
    expect(noise.flatness).toBeGreaterThan(VAD_TUNING.maxOnsetFlatness);
  });

  it("measures the same tone the same way at every common sample rate", () => {
    // Phones record at 48kHz, some laptops at 44.1kHz; the thresholds must
    // not quietly mean something different on each.
    const levels = [16_000, 44_100, 48_000].map(
      (rate) => frameFeatures(sine(1000, 0.5, rate), rate).level,
    );
    for (const level of levels) expect(level).toBeCloseTo(levels[0], 1);
  });

  it("reads about 20–30ms, whatever the buffer holds", () => {
    expect(frameSize(48_000)).toBe(1024);
    expect(frameSize(44_100)).toBe(1024);
    expect(frameSize(16_000)).toBe(512);
  });

  it("survives a buffer too short to analyse", () => {
    expect(frameFeatures(new Float32Array(10), RATE).level).toBe(0);
    expect(frameFeatures(new Float32Array(0), RATE).level).toBe(0);
  });
});

describe("decideSilence", () => {
  it("never stops before anybody has spoken", () => {
    /**
     * The assertion this module exists for. An owner who taps the microphone
     * and then thinks must still get to ask their question.
     */
    const quiet = run(silence(10_000));
    expect(quiet.latchedAt).toBeNull();
    expect(quiet.stoppedAt).toBeNull();
  });

  it("does not take a steady room for a voice, however loud", () => {
    /**
     * **The bug this rewrite fixes.** The old detector compared one fixed
     * number, and any shop louder than it latched "speech" on its own and ran
     * to the cap. The room is learned now: steady clippers become the room.
     */
    for (const amplitude of [0.02, 0.1, 0.3]) {
      const shop = run(clippers(10_000, amplitude));
      expect(shop.latchedAt, `clippers at ${amplitude}`).toBeNull();
    }
  });

  it("does not start a turn on hiss, even when it is loud against the room", () => {
    // A quiet room, then a fan switched on at full: loud relative to what was
    // learned, and flat — not a voice.
    const signal = concat(silence(1000), hiss(3000, 0.2));
    expect(run(signal, { seed: 0.001 }).latchedAt).toBeNull();
  });

  it("hears a voice in a quiet room and ends the turn after the silence", () => {
    const signal = concat(silence(600), voice(2000, 0.3), silence(4000));
    const turn = run(signal);

    expect(turn.latchedAt).not.toBeNull();
    expect(turn.latchedAt!).toBeLessThan(900);

    // The voice ends at 2600ms; the turn ends a silence later, not sooner.
    expect(turn.stoppedAt).not.toBeNull();
    expect(turn.stoppedAt!).toBeGreaterThanOrEqual(2600 + SILENCE_MS - 150);
    expect(turn.stoppedAt!).toBeLessThan(2600 + SILENCE_MS + 400);
  });

  it("ends the turn when the owner stops, even though the clippers do not", () => {
    /**
     * The whole point, in one signal: the room never goes quiet, and the turn
     * still ends a silence after the voice does. The old detector ran this to
     * its twenty-second cap every time.
     */
    const room = clippers(9000, 0.05);
    const words = concat(silence(1200), voice(2500, 0.25));
    const turn = run(add(room, words));

    expect(turn.latchedAt).not.toBeNull();
    expect(turn.stoppedAt).not.toBeNull();
    expect(turn.stoppedAt!).toBeGreaterThanOrEqual(3700 + 300);
    expect(turn.stoppedAt!).toBeLessThan(3700 + NOISY_SILENCE_MS + 900);
  });

  it("does not ratchet its idea of the room down until noise reads as voice", () => {
    /**
     * A regression the calibration found. Learning the room after the onset
     * only from buckets under the *sustain* line excluded the room's own
     * louder moments; the estimate sank, and a wobbling clipper began to
     * count as a voice that never stopped. A turn in that room must still end.
     */
    const room = clippers(14_000, 0.08, 9);
    const words = concat(silence(2000), voice(3000, 0.3));
    const turn = run(add(room, words), { seed: 0.02 });

    expect(turn.stoppedAt).not.toBeNull();
    expect(turn.stoppedAt!).toBeLessThan(5000 + NOISY_SILENCE_MS + 1500);
  });

  it("treats a pause between clauses as part of the sentence", () => {
    /**
     * Hebrew speakers pause mid-sentence like everyone else. A gap shorter
     * than the threshold has to reset the clock completely.
     */
    const signal = concat(
      silence(500),
      voice(1500, 0.3),
      silence(SILENCE_MS - 500),
      voice(1500, 0.3),
      silence(3000),
    );
    const turn = run(signal);
    const secondEnds = 500 + 1500 + (SILENCE_MS - 500) + 1500;

    expect(turn.stoppedAt!).toBeGreaterThan(secondEnds);
  });

  it("stops on the first frame past the threshold, measured from the pause", () => {
    // The state carries the start of the quiet spell; a per-frame comparison
    // would never accumulate and never fire. Seeded with a quiet room: an
    // unchanging level with nothing to compare it to *is* the room.
    let state = initialSilenceState(0.001);
    const loud = { level: 0.2, flatness: 0.05 };
    for (let t = 16; t <= 400; t += 16) {
      state = decideSilence(state, loud, t).state;
    }
    expect(state.spoke).toBe(true);

    const quiet = { level: 0, flatness: 1 };
    let stoppedAt: number | null = null;
    for (let t = 416; t <= 5000 && stoppedAt === null; t += 16) {
      const outcome = decideSilence(state, quiet, t);
      state = outcome.state;
      if (outcome.stop) stoppedAt = t;
    }

    expect(stoppedAt).not.toBeNull();
    const quietFrom = 416;
    expect(stoppedAt! - quietFrom).toBeGreaterThanOrEqual(SILENCE_MS);
    // The level is smoothed over ~100ms, so a cliff-edge drop takes about two
    // hundred more to fall below the line — the price of not flapping on
    // every noise crest, and the whole of the slack allowed here.
    expect(stoppedAt! - quietFrom).toBeLessThan(SILENCE_MS + 32 + 250);
  });

  it("keeps the pause short in a quiet room and long in a loud one", () => {
    /**
     * The pause is the largest wait in every turn. 1.4s where the owner
     * stands clear of the room; 1.8s — the value a live run once measured —
     * where they do not, because the calibration showed the shorter pause
     * clipping the soft end of sentences only a few dB above the noise.
     */
    expect(SILENCE_MS).toBe(1400);
    expect(NOISY_SILENCE_MS).toBe(1800);
    expect(SHORT_SILENCE_MS).toBeLessThan(SILENCE_MS);
  });

  it("waits the longer pause when the voice barely clears the room", () => {
    // A loud room, and a voice only twice as loud as it: the full margin.
    let state = initialSilenceState(0.1);
    for (let t = 16; t <= 600; t += 16) {
      state = decideSilence(state, { level: 0.2, flatness: 0.05 }, t).state;
    }
    expect(state.spoke).toBe(true);

    let stoppedAt: number | null = null;
    for (let t = 616; t <= 6000 && stoppedAt === null; t += 16) {
      const outcome = decideSilence(state, { level: 0.1, flatness: 0.5 }, t);
      state = outcome.state;
      if (outcome.stop) stoppedAt = t;
    }
    expect(stoppedAt! - 616).toBeGreaterThanOrEqual(NOISY_SILENCE_MS);
  });

  it("ends a one-word answer sooner, when an answer is what it expects", () => {
    /**
     * "כן" is finished when it is said. Waiting the full pause after it was
     * most of a confirmation turn's delay; the caller passes the short pause
     * when ליבי has just asked something.
     */
    const answer = (short?: number) => {
      let state = initialSilenceState(0.001);
      // ~300ms of voice: a one-word answer.
      for (let t = 16; t <= 300; t += 16) {
        state = decideSilence(
          state,
          { level: 0.2, flatness: 0.05 },
          t,
          SILENCE_MS,
          undefined,
          short,
        ).state;
      }
      for (let t = 316; t <= 5000; t += 16) {
        const outcome = decideSilence(
          state,
          { level: 0, flatness: 1 },
          t,
          SILENCE_MS,
          undefined,
          short,
        );
        state = outcome.state;
        if (outcome.stop) return t - 316;
      }
      return null;
    };

    const quick = answer(SHORT_SILENCE_MS)!;
    const normal = answer()!;
    expect(quick).toBeLessThan(SHORT_SILENCE_MS + 300);
    expect(normal).toBeGreaterThanOrEqual(SILENCE_MS);
  });

  it("gives a sentence the full pause even when an answer was expected", () => {
    // Anything longer than a word is a sentence — "כן, ותזיזי גם את דני" —
    // and a sentence may pause mid-way.
    let state = initialSilenceState(0.001);
    for (let t = 16; t <= 2000; t += 16) {
      state = decideSilence(
        state,
        { level: 0.2, flatness: 0.05 },
        t,
        SILENCE_MS,
        undefined,
        SHORT_SILENCE_MS,
      ).state;
    }
    expect(state.voicedMs).toBeGreaterThan(SHORT_VOICE_MS);

    let stoppedAt: number | null = null;
    for (let t = 2016; t <= 6000 && stoppedAt === null; t += 16) {
      const outcome = decideSilence(
        state,
        { level: 0, flatness: 1 },
        t,
        SILENCE_MS,
        undefined,
        SHORT_SILENCE_MS,
      );
      state = outcome.state;
      if (outcome.stop) stoppedAt = t;
    }
    expect(stoppedAt! - 2016).toBeGreaterThanOrEqual(SILENCE_MS);
  });

  it("starts from the room the previous turn left, when told it", () => {
    // Seeded, a voice at the very first frame is heard as a voice rather than
    // mistaken for the background.
    const seeded = run(concat(voice(1500, 0.3), silence(3000)), {
      seed: 0.001,
    });
    expect(seeded.latchedAt).not.toBeNull();
    expect(seeded.latchedAt!).toBeLessThan(400);
  });

  it("is a fresh turn out of the box", () => {
    expect(INITIAL_SILENCE_STATE.spoke).toBe(false);
    expect(INITIAL_SILENCE_STATE.lastAt).toBe(0);
  });
});

describe("idleOutcome", () => {
  it("waits until the window has passed", () => {
    expect(idleOutcome(INITIAL_SILENCE_STATE, IDLE_MS - 1)).toBe("wait");
  });

  it("discards a turn nobody made a sound in", () => {
    /**
     * **The turn the owner did not ask for.** Nothing in it could have been a
     * word, so nothing is sent: no bill, and no "לא שמעתי" said to a room.
     */
    const turn = run(silence(IDLE_MS + 500), { idleMs: IDLE_MS });
    expect(turn.idle).toBe("discard");
  });

  it("discards a steady shop, too", () => {
    const turn = run(clippers(IDLE_MS + 500, 0.1), {
      idleMs: IDLE_MS,
      seed: 0.1,
    });
    expect(turn.idle).toBe("discard");
  });

  it("sends a turn where something happened that never latched", () => {
    /**
     * A short "כן" under a radio can cross the line without ever standing
     * above it long enough to latch. Throwing it away loses an answer; sending
     * it costs one transcription, which answers noise with an empty string.
     */
    let state = initialSilenceState(0.01);
    // Loud, but flat: activity without a voice-shaped onset.
    for (let t = 16; t <= 600; t += 16) {
      state = decideSilence(state, { level: 0.2, flatness: 0.9 }, t).state;
    }
    expect(state.spoke).toBe(false);
    expect(idleOutcome(state, IDLE_MS)).toBe("send");
  });

  it("never fires once anybody has spoken", () => {
    /**
     * After speech the turn belongs to `decideSilence`, and a second timer
     * firing over it would discard a question the owner actually asked.
     */
    let state = initialSilenceState(0.001);
    for (let t = 16; t <= 400; t += 16) {
      state = decideSilence(state, { level: 0.3, flatness: 0.05 }, t).state;
    }
    expect(state.spoke).toBe(true);

    for (const elapsed of [0, IDLE_MS, IDLE_MS * 10, 600_000]) {
      expect(idleOutcome(state, elapsed), `${elapsed}ms`).toBe("wait");
    }
  });

  it("takes a window, so a pressed turn can be more patient", () => {
    expect(idleOutcome(INITIAL_SILENCE_STATE, 3_000, 10_000)).toBe("wait");
    expect(idleOutcome(INITIAL_SILENCE_STATE, 10_000, 10_000)).toBe("discard");
  });

  it("gives a pressed turn longer than one that opened by itself", () => {
    /**
     * The window for a continued turn is one to keep talking through, not one
     * to think in; somebody who needs longer presses the button, and a pressed
     * turn waits longer — and then sends rather than discards.
     */
    expect(IDLE_MS).toBeGreaterThanOrEqual(3_000);
    expect(IDLE_MS).toBeLessThanOrEqual(6_000);
    expect(PRESSED_IDLE_MS).toBeGreaterThan(IDLE_MS);
  });
});
