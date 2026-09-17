/**
 * Deciding when the owner has started talking, and when they have stopped —
 * in a room with clippers, a radio and a street in it.
 *
 * ---------------------------------------------------------------------------
 * Pure, and separated from the component for the usual reason: the arithmetic
 * is the part that can be quietly wrong. The component owns the `AnalyserNode`
 * and the animation frame; this owns what the samples mean.
 *
 * **The fixed threshold this replaces was the bug.** One RMS number (0.025),
 * compared on 8-bit samples, with the browser's automatic gain turned on: any
 * room louder than the line latched "speech" on its own, the 1.8s of quiet that
 * ends a turn never arrived, and the recording ran to its cap — twenty seconds
 * of radio and other people's voices, transcribed faithfully and handed to the
 * model as the owner's request.
 *
 * **What it does instead is learn the room.**
 *
 * - The level is measured **in the speech band only** (250–3800 Hz, from an
 *   FFT of the latest ~20ms), so a clipper's motor hum and hiss and a radio's
 *   bass count for little.
 * - The **room** is the median of the recent level, in 100ms buckets over
 *   two seconds. Before the owner speaks, every bucket counts, so a steady
 *   noise *becomes* the room within two seconds instead of passing for a voice
 *   forever. After they speak, a bucket counts unless it is loud enough to be
 *   them — a voice must not teach the detector that the room is loud.
 * - **Speech starts** when the level stands well above the room for a
 *   syllable's length *and* the spectrum is peaked like a voiced sound rather
 *   than flat like a clipper's hiss.
 * - **Speech ends** when the level falls back toward the room — or far below
 *   the loudest the owner was this turn, which separates a voice held near the
 *   phone from a radio across the room — and stays there for a pause that is
 *   shorter in a quiet room than in a loud one (see {@link SILENCE_MS}).
 *
 * **Calibrated, not guessed.** Every threshold below was set against the
 * sixteen spoken commands from the transcription benchmark, run through this
 * module frame by frame at 48kHz — clean, under synthetic clippers at 10dB and
 * 3dB, and under a music bed with a melody in it at 6dB — each followed by six
 * more seconds of the same noise. The numbers the tuning was held to are in
 * `libi-vad.test.ts`.
 * ---------------------------------------------------------------------------
 */

/**
 * How long a pause has to last before it counts as "finished speaking".
 *
 * ---------------------------------------------------------------------------
 * **1.4s where the owner stands clear of the room, 1.8s where they do not.**
 * The pause is the single largest wait in a turn — paid in full after the last
 * word, before a byte leaves the phone — so it was the first thing to cut when
 * speed became the priority. Measured on the calibration clips, cutting it
 * everywhere was a mistake: in a quiet shop and under clippers 10dB down it cut
 * nothing, but where the voice is only a few dB above the noise the soft end of
 * a sentence reads as quiet, and the shorter pause clipped three commands the
 * longer one had kept. So the pause follows the room: {@link NOISY_SILENCE_MS}
 * once the owner's own peak is less than {@link CLEAR_PEAK_RATIO} times the
 * room.
 *
 * Someone who pauses longer mid-sentence can hold the button: a held turn ends
 * when it is let go, whatever the detector hears.
 * ---------------------------------------------------------------------------
 */
export const SILENCE_MS = 1400;
export const NOISY_SILENCE_MS = 1800;
/** The owner's peak over the room, ×5 ≈ 14dB, below which the room is loud. */
export const CLEAR_PEAK_RATIO = 5;

/**
 * The pause after a one-word answer, when ליבי has just asked a question.
 *
 * "כן" is complete the moment it is said; waiting the full pause after it is
 * most of the delay in a confirmation turn. Applied only when the caller says
 * an answer is expected, and only to an utterance shorter than
 * {@link SHORT_VOICE_MS} — anything longer is a sentence, and gets the full
 * pause.
 */
export const SHORT_SILENCE_MS = 800;
export const SHORT_VOICE_MS = 600;

/**
 * How long a re-opened microphone waits for the owner to say anything at all.
 *
 * ---------------------------------------------------------------------------
 * **This exists because the latch is a one-way door.** Nothing may auto-stop
 * until somebody has spoken, which is exactly right when the owner pressed the
 * button — they meant to talk, and cutting them off while they think is the
 * worst thing this component can do.
 *
 * It is exactly wrong when the microphone re-opened *on its own* after ליבי
 * finished answering. Nobody asked for that turn, so nobody may be about to use
 * it.
 *
 * **4.5 seconds.** Long enough to draw breath and start a follow-up, short
 * enough that a conversation nobody continued closes while the owner is still
 * looking at the screen. It is a window to keep talking through, not a pause to
 * think in: anyone who needs longer presses the button.
 * ---------------------------------------------------------------------------
 */
export const IDLE_MS = 4500;

/**
 * How long a *pressed* turn waits for a voice before it stops waiting.
 *
 * It then **sends** what it has rather than discarding it: the owner pressed
 * the button to say something, and a voice too buried in noise to latch is
 * still worth the transcriber's attention — which, measured, answers noise with
 * an empty string rather than an invention.
 */
export const PRESSED_IDLE_MS = 8000;

/** The band a voice lives in; everything outside it is mostly the room. */
export const BAND_LOW_HZ = 250;
export const BAND_HIGH_HZ = 3800;

/**
 * The knobs, in one object so the calibration harness and the tests can
 * vary them — and so there is exactly one place to read what the detector
 * believes.
 */
export type VadTuning = {
  /** Onset: the level must stand this far above the room… */
  onsetRatio: number;
  /** …for this long, counting only voice-shaped frames… */
  onsetMs: number;
  /** …where voice-shaped means a spectrum at most this flat. */
  maxOnsetFlatness: number;
  /** After the onset, a frame is voice while it stands this far above the room… */
  sustainRatio: number;
  /** …and within this fraction of the loudest the owner was this turn. */
  peakRatio: number;
  /** Which percentile of the recent buckets is "the room". */
  roomPercentile: number;
  /** A voice that runs this long without a quiet bucket means the room changed. */
  roomStaleMs: number;
  /**
   * An idle turn with at least this much above-the-room sound in it is sent
   * rather than discarded: something happened in it that could have been a
   * word — a short "כן" under a radio crosses the line without ever latching.
   */
  idleActivityMs: number;
};

export const VAD_TUNING: VadTuning = {
  onsetRatio: 1.4,
  onsetMs: 80,
  maxOnsetFlatness: 0.3,
  sustainRatio: 1.4,
  peakRatio: 0.125,
  roomPercentile: 0.5,
  roomStaleMs: 4000,
  idleActivityMs: 120,
};

/**
 * Absolute floors, as band RMS (full scale = 1). The relative rules do the
 * work; these only stop a silent room — where the room level is almost zero and
 * the gain control is hunting — from treating its own hiss as a voice.
 */
export const MIN_ONSET_LEVEL = 0.004;
const MIN_SUSTAIN_LEVEL = 0.0028;
const MIN_ROOM = 0.0005;

const SMOOTH_MS = 100;
const BUCKET_MS = 100;
const ROOM_BUCKETS = 20;

export type FrameFeatures = {
  /** RMS of the speech band, 0…~1. */
  level: number;
  /** Spectral flatness of the speech band, 0 (a pure tone) … 1 (white noise). */
  flatness: number;
};

/* -------------------------------------------------------------------------- */
/* Features                                                                    */
/* -------------------------------------------------------------------------- */

const hannWindows = new Map<number, { window: Float64Array; energy: number }>();

function hann(size: number) {
  let cached = hannWindows.get(size);
  if (!cached) {
    const window = new Float64Array(size);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      energy += window[i] * window[i];
    }
    cached = { window, energy };
    hannWindows.set(size, cached);
  }
  return cached;
}

/** In-place radix-2 FFT. `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** The analysis length for a sample rate: ~20–30ms, a power of two. */
export function frameSize(sampleRate: number): number {
  const target = sampleRate * 0.032;
  let size = 256;
  while (size * 2 <= target) size *= 2;
  return size;
}

/**
 * The level and shape of the most recent slice of audio.
 *
 * Takes the analyser's float time-domain buffer as it is and reads only its
 * newest {@link frameSize} samples. Level is band RMS — Parseval over the
 * band's bins, normalised by the window's energy, so a full-scale sine inside
 * the band reads ~0.707 exactly like a time-domain RMS would.
 */
export function frameFeatures(
  samples: Float32Array,
  sampleRate: number,
): FrameFeatures {
  const available = 2 ** Math.floor(Math.log2(Math.max(1, samples.length)));
  const size = Math.min(frameSize(sampleRate), available);
  if (size < 64) return { level: 0, flatness: 1 };

  const { window, energy } = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const offset = samples.length - size;
  for (let i = 0; i < size; i++) re[i] = samples[offset + i] * window[i];
  fft(re, im);

  const low = Math.max(1, Math.ceil((BAND_LOW_HZ * size) / sampleRate));
  const high = Math.min(
    size / 2 - 1,
    Math.floor((BAND_HIGH_HZ * size) / sampleRate),
  );

  let sum = 0;
  let logSum = 0;
  let bins = 0;
  for (let k = low; k <= high; k++) {
    const power = re[k] * re[k] + im[k] * im[k];
    sum += power;
    logSum += Math.log(power + 1e-20);
    bins += 1;
  }

  if (bins === 0 || sum <= 1e-18) return { level: 0, flatness: 1 };

  return {
    level: Math.sqrt((2 * sum) / (size * energy)),
    flatness: Math.min(1, Math.exp(logSum / bins) / (sum / bins)),
  };
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export type SilenceState = {
  /** Whether a real onset has been heard this turn. One-way. */
  spoke: boolean;
  /** When the current quiet spell began, or 0 while there is voice. */
  quietSince: number;
  /** How long the owner has been audibly speaking this turn. */
  voicedMs: number;
  /** Voice-shaped time above the onset level, leaky, before the latch. */
  onsetMs: number;
  /** Any time above the onset level at all — "something happened". */
  activityMs: number;
  /** The level, smoothed over ~100ms. */
  smooth: number;
  /** The room, as last estimated. */
  room: number;
  /** Mean `smooth` per 100ms bucket that counts toward the room, oldest first. */
  buckets: readonly number[];
  bucketStart: number;
  bucketSum: number;
  bucketFrames: number;
  /** When a bucket last counted toward the room. */
  roomUpdatedAt: number;
  /**
   * Set when a voice ran `roomStaleMs` without a quiet bucket: the room has
   * probably changed, so every bucket counts until one is quiet again.
   */
  adapting: boolean;
  /** The loudest smoothed level heard as voice this turn. */
  peak: number;
  /** When the previous frame was taken; 0 before the first. */
  lastAt: number;
};

/**
 * A fresh turn.
 *
 * `seedRoom` is the room as the previous turn left it. Without it, a turn that
 * opens mid-word would take its first word for the room; with it the estimate
 * is right from the first frame, and still free to move within two seconds if
 * the room got louder while ליבי was talking.
 */
export function initialSilenceState(seedRoom?: number): SilenceState {
  const seeded = seedRoom && seedRoom > 0 ? seedRoom : 0;
  return {
    spoke: false,
    quietSince: 0,
    voicedMs: 0,
    onsetMs: 0,
    activityMs: 0,
    smooth: 0,
    room: seeded || MIN_ROOM,
    buckets: seeded ? Array<number>(ROOM_BUCKETS / 2).fill(seeded) : [],
    bucketStart: 0,
    bucketSum: 0,
    bucketFrames: 0,
    roomUpdatedAt: 0,
    adapting: false,
    peak: 0,
    lastAt: 0,
  };
}

export const INITIAL_SILENCE_STATE: SilenceState = initialSilenceState();

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * One frame's worth of decision.
 *
 * **The latch is still the whole point.** Nothing may stop the recording until
 * a voice has been heard at least once: without it, a quiet room starts the
 * clock at frame one and the microphone closes before the owner has drawn
 * breath. What changed is what counts as a voice — see the module header.
 *
 * Returns the next state and whether to stop, rather than mutating or calling
 * back — which is what makes the sequence testable without an audio graph.
 *
 * `shortSilenceMs`, when given, is the pause that ends a turn whose speech so
 * far is shorter than {@link SHORT_VOICE_MS} — the caller passes it when ליבי
 * has just asked a question and a one-word answer is what it expects.
 */
export function decideSilence(
  state: SilenceState,
  frame: FrameFeatures,
  now: number,
  silenceMs = SILENCE_MS,
  tuning: VadTuning = VAD_TUNING,
  shortSilenceMs?: number,
): { state: SilenceState; stop: boolean } {
  const first = state.lastAt === 0;
  const dt = first ? 16 : Math.min(100, Math.max(0, now - state.lastAt));

  const smooth = first
    ? frame.level
    : state.smooth +
      (frame.level - state.smooth) * (1 - Math.exp(-dt / SMOOTH_MS));

  const thresholds = (room: number, peak: number) => ({
    onset: Math.max(MIN_ONSET_LEVEL, room * tuning.onsetRatio),
    sustain: Math.max(
      MIN_SUSTAIN_LEVEL,
      room * tuning.sustainRatio,
      peak * tuning.peakRatio,
    ),
  });

  /**
   * The room, in buckets. Before the latch every bucket counts. After it, a
   * bucket counts unless it is loud enough to be the owner — **below the
   * onset line, not below the sustain line.** The stricter rule was tried and
   * ratcheted: it excluded the room's own louder moments, the estimate sank,
   * and ordinary noise began to read as a voice that never stopped. And if
   * nothing has counted for `roomStaleMs` — which a real voice never does, it
   * breathes — the room has changed, and everything counts until it settles.
   */
  let {
    buckets,
    bucketStart,
    bucketSum,
    bucketFrames,
    roomUpdatedAt,
    adapting,
  } = state;
  if (first) {
    bucketStart = now;
    roomUpdatedAt = now;
  }
  bucketSum += smooth;
  bucketFrames += 1;

  if (now - bucketStart >= BUCKET_MS) {
    const mean = bucketSum / bucketFrames;
    const quiet = mean < thresholds(state.room, 0).onset;
    if (state.spoke && !quiet && now - roomUpdatedAt >= tuning.roomStaleMs) {
      adapting = true;
    }
    if (quiet) adapting = false;
    if (!state.spoke || quiet || adapting) {
      buckets = [...buckets, mean].slice(-ROOM_BUCKETS);
      roomUpdatedAt = now;
    }
    bucketStart = now;
    bucketSum = 0;
    bucketFrames = 0;
  }

  const room =
    buckets.length > 0
      ? Math.max(MIN_ROOM, percentile(buckets, tuning.roomPercentile))
      : Math.max(MIN_ROOM, smooth);

  const { onset, sustain } = thresholds(room, state.peak);
  const loud = smooth >= onset;
  const activityMs = loud ? state.activityMs + dt : state.activityMs;

  const base: SilenceState = {
    ...state,
    smooth,
    room,
    buckets,
    bucketStart,
    bucketSum,
    bucketFrames,
    roomUpdatedAt,
    adapting,
    activityMs,
    lastAt: now,
  };

  if (!state.spoke) {
    /**
     * Leaky, and leaking at half the rate it fills: speech in noise crosses
     * the line in bursts, syllable by syllable, and a strict run would reset
     * on every consonant. A click, or a noise crest, fills it once and drains.
     */
    const voiceLike = loud && frame.flatness <= tuning.maxOnsetFlatness;
    const onsetMs = voiceLike
      ? state.onsetMs + dt
      : Math.max(0, state.onsetMs - dt / 2);
    const spoke = onsetMs >= tuning.onsetMs;

    return {
      state: {
        ...base,
        spoke,
        onsetMs,
        peak: spoke ? smooth : 0,
        // The onset itself was speech; count it, or a one-word answer would
        // look shorter than it was.
        voicedMs: spoke ? onsetMs : 0,
      },
      stop: false,
    };
  }

  if (smooth >= sustain) {
    // Sound resets the pause; a gap between two clauses is not the end.
    return {
      state: {
        ...base,
        quietSince: 0,
        voicedMs: state.voicedMs + dt,
        peak: Math.max(state.peak, smooth),
      },
      stop: false,
    };
  }

  const quietSince = state.quietSince === 0 ? now : state.quietSince;
  const noisy = state.peak < room * CLEAR_PEAK_RATIO;
  const full = noisy ? Math.max(silenceMs, NOISY_SILENCE_MS) : silenceMs;
  const pause =
    shortSilenceMs !== undefined && state.voicedMs < SHORT_VOICE_MS
      ? Math.min(full, shortSilenceMs)
      : full;
  return {
    state: { ...base, quietSince },
    stop: now - quietSince >= pause,
  };
}

export type IdleOutcome = "wait" | "discard" | "send";

/**
 * What to do with a turn nobody has (audibly) spoken into.
 *
 * Deliberately **not** folded into `decideSilence`: that answers "has this
 * sentence finished", and its answer feeds a send. This answers "was there a
 * sentence at all" — and, new with the noisy-room work, "or something that
 * might have been one, too buried to latch", which is sent rather than thrown
 * away. A turn with nothing in it at all is discarded.
 *
 * `elapsedMs` is measured from when the microphone opened.
 */
export function idleOutcome(
  state: SilenceState,
  elapsedMs: number,
  idleMs = IDLE_MS,
  tuning: VadTuning = VAD_TUNING,
): IdleOutcome {
  // Once anybody has spoken this never fires again, and `decideSilence` owns
  // the rest of the turn.
  if (state.spoke || elapsedMs < idleMs) return "wait";
  return state.activityMs >= tuning.idleActivityMs ? "send" : "discard";
}
