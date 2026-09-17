import { describe, expect, it } from "vitest";

import { SPEECH_RATE, timeStretch } from "./libi-stretch";

/**
 * Faster, at the same pitch.
 *
 * The whole reason this exists instead of `playbackRate` is the second half of
 * that sentence, so it is the thing measured: the dominant frequency of a
 * stretched tone, counted from its zero crossings, has to stay where it was.
 */
const RATE = 22_050;

const tone = (hz: number, seconds: number, amplitude = 0.5) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / RATE),
  );

/** A tone that glides, like a voice does across a sentence. */
const glide = (seconds: number) => {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const hz = 120 + 60 * Math.sin((2 * Math.PI * 0.8 * i) / RATE);
    phase += (2 * Math.PI * hz) / RATE;
    out[i] =
      0.5 *
      Math.sin(phase) *
      (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / RATE));
  }
  return out;
};

function frequency(samples: Float32Array, from = 0.2, to = 0.8): number {
  const start = Math.floor(samples.length * from);
  const end = Math.floor(samples.length * to);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings += 1;
  }
  return crossings / ((end - start) / RATE);
}

const rms = (samples: Float32Array, from = 0.2, to = 0.8) => {
  const start = Math.floor(samples.length * from);
  const end = Math.floor(samples.length * to);
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
};

describe("timeStretch", () => {
  it("is shorter by the rate", () => {
    const input = tone(220, 3);
    const output = timeStretch(input, RATE, 1.1);
    expect(output.length).toBe(Math.floor(input.length / 1.1));
  });

  it("keeps the pitch where it was", () => {
    // The point of the module: `playbackRate` would read ~242Hz here.
    for (const hz of [110, 220, 440]) {
      const output = timeStretch(tone(hz, 3), RATE, 1.1);
      expect(frequency(output), `${hz}Hz`).toBeGreaterThan(hz * 0.97);
      expect(frequency(output), `${hz}Hz`).toBeLessThan(hz * 1.03);
    }
  });

  it("keeps the loudness where it was", () => {
    const input = tone(220, 3);
    const output = timeStretch(input, RATE, 1.1);
    expect(rms(output)).toBeGreaterThan(rms(input) * 0.9);
    expect(rms(output)).toBeLessThan(rms(input) * 1.1);
  });

  it("does not click where the windows meet", () => {
    // A seam in the wrong place is a jump no sine of this frequency can make
    // between two neighbouring samples.
    const output = timeStretch(tone(220, 2), RATE, 1.1);
    const limit = 0.5 * ((2 * Math.PI * 220) / RATE) * 1.5;
    let worst = 0;
    const start = Math.floor(output.length * 0.1);
    const end = Math.floor(output.length * 0.9);
    for (let i = start + 1; i < end; i++) {
      worst = Math.max(worst, Math.abs(output[i] - output[i - 1]));
    }
    expect(worst).toBeLessThan(limit);
  });

  it("follows a voice that moves", () => {
    const input = glide(3);
    const output = timeStretch(input, RATE, SPEECH_RATE);
    // Same average pitch, same loudness, shorter.
    expect(frequency(output, 0.1, 0.9)).toBeGreaterThan(
      frequency(input, 0.1, 0.9) * 0.9,
    );
    expect(frequency(output, 0.1, 0.9)).toBeLessThan(
      frequency(input, 0.1, 0.9) * 1.1,
    );
    expect(rms(output, 0.1, 0.9)).toBeGreaterThan(rms(input, 0.1, 0.9) * 0.8);
    expect(output.length).toBeLessThan(input.length);
  });

  it("leaves a rate of one, and clips too short to window, alone", () => {
    const input = tone(220, 1);
    expect(timeStretch(input, RATE, 1)).toBe(input);
    const tiny = new Float32Array(100);
    expect(timeStretch(tiny, RATE, 1.1)).toBe(tiny);
    const empty = new Float32Array(0);
    expect(timeStretch(empty, RATE, 1.1)).toBe(empty);
    expect(timeStretch(input, RATE, Number.NaN)).toBe(input);
  });

  it("works at the rate the browser decodes at, too", () => {
    const at48 = Float32Array.from(
      { length: 48_000 * 2 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / 48_000),
    );
    const output = timeStretch(at48, 48_000, 1.1);
    expect(output.length).toBe(Math.floor(at48.length / 1.1));
  });

  it("is quick enough to run before every clip", () => {
    // A long reply clip at the decode rate. Budgeted generously: this runs in
    // CI, not on a phone, and exists to catch an accidental blow-up.
    const input = glide(6);
    const started = performance.now();
    timeStretch(input, RATE, SPEECH_RATE);
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("speaks a tenth faster by default", () => {
    expect(SPEECH_RATE).toBeGreaterThan(1);
    expect(SPEECH_RATE).toBeLessThanOrEqual(1.15);
  });
});
