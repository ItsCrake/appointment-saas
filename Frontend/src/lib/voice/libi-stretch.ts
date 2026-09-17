/**
 * ליבי, a little quicker — without her voice going up.
 *
 * ---------------------------------------------------------------------------
 * **Why this is in the browser.** ElevenLabs' v3 models accept a `speed`
 * setting and ignore it: measured three times each at 0.8, 1.2 and unset, the
 * same sentence came back between 5.7s and 7.0s at random. The only other
 * lever in the browser, `playbackRate` on a buffer source, is a tape played
 * fast — quicker, and a semitone and a half higher, which is not the same
 * person.
 *
 * **WSOLA.** The clip is cut into overlapping windows and laid back down closer
 * together; each window is taken from wherever, near its ideal position, it
 * best continues the waveform already laid, so the pitch periods line up
 * instead of smearing. It is the standard method for speech at modest rates,
 * and ten percent is modest.
 *
 * **Pure and cheap.** A four-second sentence at 22kHz is ~350 windows and a
 * bounded search each — tens of milliseconds, once per clip, before it plays.
 * ---------------------------------------------------------------------------
 */

/**
 * How much faster than the model's own delivery ליבי speaks.
 *
 * Ten percent: enough to be felt across a conversation, well short of the
 * point where Hebrew consonants start to run together. `1` turns this off.
 */
export const SPEECH_RATE: number = 1.1;

/** The window, ~23ms at 22kHz: a few pitch periods of a speaking voice. */
function windowSize(sampleRate: number): number {
  const target = sampleRate * 0.023;
  let size = 128;
  while (size * 2 <= target) size *= 2;
  return size;
}

const windows = new Map<number, Float32Array>();

/** A periodic Hann window, which sums to exactly one at half overlap. */
function hann(size: number): Float32Array {
  let window = windows.get(size);
  if (!window) {
    window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    }
    windows.set(size, window);
  }
  return window;
}

/**
 * The samples, played `rate` times faster at the same pitch.
 *
 * Returns the input untouched for a rate of one, an empty clip, or one too
 * short to have a window in it.
 */
export function timeStretch(
  input: Float32Array,
  sampleRate: number,
  rate: number,
): Float32Array {
  if (rate === 1 || !Number.isFinite(rate) || rate <= 0) return input;

  const size = windowSize(sampleRate);
  if (input.length < size * 2) return input;

  const synthesisHop = size / 2;
  const analysisHop = Math.max(1, Math.round(synthesisHop * rate));
  // Wide enough to find the same point of a low male voice's pitch period
  // (~12ms), narrow enough to keep the search cheap.
  const tolerance = Math.min(size / 2, Math.round(sampleRate * 0.012));
  const window = hann(size);

  // Zero-padded so the last window has a whole frame to read.
  const source = new Float32Array(input.length + size * 2);
  source.set(input);

  const outputLength = Math.floor(input.length / rate);
  const output = new Float32Array(outputLength + size);

  let previous = 0;
  for (let k = 0; ; k++) {
    const ideal = k * analysisHop;
    const at = k * synthesisHop;
    if (ideal >= input.length || at >= outputLength) break;

    let best = ideal;
    if (k > 0) {
      // Where the window laid last time would have continued, naturally.
      const natural = previous + synthesisHop;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let delta = -tolerance; delta <= tolerance; delta += 2) {
        const candidate = ideal + delta;
        if (candidate < 0 || candidate + size > source.length) continue;
        let score = 0;
        for (let i = 0; i < size; i += 4) {
          score += source[candidate + i] * source[natural + i];
        }
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }

    for (let i = 0; i < size; i++) {
      output[at + i] += source[best + i] * window[i];
    }
    previous = best;
  }

  return output.slice(0, outputLength);
}
