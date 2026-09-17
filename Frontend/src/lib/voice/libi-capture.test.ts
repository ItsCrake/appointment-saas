import { describe, expect, it } from "vitest";

import {
  AUDIO_CONSTRAINTS,
  MAX_CONTINUED_TURN_MS,
  MAX_PRESSED_TURN_MS,
  MAX_UNHEARD_TURNS,
  pickRecorderMimeType,
  RECORDER_BITS_PER_SECOND,
  RECORDER_MIME_TYPES,
  RELEASE_TAIL_MS,
  ROOM_SEED_MAX_AGE_MS,
} from "./libi-capture";
import { IDLE_MS, PRESSED_IDLE_MS, SILENCE_MS } from "./libi-vad";

/**
 * How the microphone is opened, pinned.
 *
 * Every value here is a decision somebody could "tidy" away without seeing
 * what it was for — the constraints that let the browser attenuate a clipper
 * before anything hears it, the tail that keeps the last syllable, the caps
 * that stop a radio from being transcribed for twenty seconds.
 */
describe("AUDIO_CONSTRAINTS", () => {
  it("asks for the browser's own voice processing, by name", () => {
    // Chrome happens to default these on; other engines decide for
    // themselves, and "happens to" is not a setting.
    expect(AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    });
  });
});

describe("pickRecorderMimeType", () => {
  it("prefers WebM/Opus where it is available", () => {
    expect(pickRecorderMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to Safari's MP4", () => {
    const safari = (type: string) => type === "audio/mp4";
    expect(pickRecorderMimeType(safari)).toBe("audio/mp4");
  });

  it("keeps Ogg last, since the primary transcriber does not list it", () => {
    expect(RECORDER_MIME_TYPES.at(-1)).toContain("ogg");
    const firefoxOnlyOgg = (type: string) => type.startsWith("audio/ogg");
    expect(pickRecorderMimeType(firefoxOnlyOgg)).toBe("audio/ogg;codecs=opus");
  });

  it("lets the browser choose when it supports none of them, or cannot say", () => {
    expect(pickRecorderMimeType(() => false)).toBeUndefined();
    expect(pickRecorderMimeType(undefined)).toBeUndefined();
    expect(
      pickRecorderMimeType(() => {
        throw new Error("not implemented");
      }),
    ).toBeUndefined();
  });
});

describe("the capture numbers", () => {
  it("records a voice small, not badly", () => {
    // Opus is transparent for speech well below this; far below it is not.
    expect(RECORDER_BITS_PER_SECOND).toBeGreaterThanOrEqual(24_000);
    expect(RECORDER_BITS_PER_SECOND).toBeLessThanOrEqual(64_000);
  });

  it("keeps a tail long enough for a syllable and short enough not to wait on", () => {
    expect(RELEASE_TAIL_MS).toBeGreaterThanOrEqual(300);
    expect(RELEASE_TAIL_MS).toBeLessThanOrEqual(800);
  });

  it("caps a turn only after silence and idleness have had their chance", () => {
    // The caps are backstops. If one fired before the detector could, every
    // long command would be cut off at the cap instead of at its end.
    expect(MAX_CONTINUED_TURN_MS).toBeGreaterThan(IDLE_MS + SILENCE_MS);
    expect(MAX_PRESSED_TURN_MS).toBeGreaterThan(PRESSED_IDLE_MS);
    expect(MAX_PRESSED_TURN_MS).toBeGreaterThanOrEqual(MAX_CONTINUED_TURN_MS);
    // …and nothing runs as long as the twenty seconds the old cap allowed.
    expect(MAX_PRESSED_TURN_MS).toBeLessThan(20_000);
  });

  it("lets a room estimate outlive a conversation's gaps but not an hour", () => {
    expect(ROOM_SEED_MAX_AGE_MS).toBeGreaterThanOrEqual(30_000);
    expect(ROOM_SEED_MAX_AGE_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("gives an unheard turn a retry, not an endless loop", () => {
    expect(MAX_UNHEARD_TURNS).toBeGreaterThanOrEqual(1);
    expect(MAX_UNHEARD_TURNS).toBeLessThanOrEqual(3);
  });
});
