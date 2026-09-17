import { describe, expect, it } from "vitest";

import {
  ACCEPTED_AUDIO_TYPES,
  audioExtension,
  isAcceptedAudioType,
  STT_FALLBACK_MODEL,
  STT_MODEL,
  STT_TIMEOUT_MS,
} from "./libi-config";

/**
 * The speech-in half of the configuration.
 *
 * `voice-isolation.test.ts` guards who may import this module; this guards
 * what it says.
 */
describe("transcription models", () => {
  it("hears with gpt-transcribe and falls back to whisper-1", () => {
    /**
     * Chosen by measurement — 208 of 224 names, verbs and times against
     * whisper-1's 149, at half the latency. The fallback is the model that
     * accepts everything the primary might refuse.
     */
    expect(STT_MODEL).toBe("gpt-transcribe");
    expect(STT_FALLBACK_MODEL).toBe("whisper-1");
  });

  it("gives up on the primary early enough for the fallback to answer", () => {
    // The route's budget is 60s and a turn also pays for the intent model and
    // speech; two transcription attempts must fit well inside it.
    expect(STT_TIMEOUT_MS * 2).toBeLessThan(30_000);
    expect(STT_TIMEOUT_MS).toBeGreaterThanOrEqual(4_000);
  });
});

describe("audioExtension", () => {
  it("names what each browser records the way the API expects", () => {
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtension("audio/mp4")).toBe("mp4");
    expect(audioExtension("audio/ogg; codecs=opus")).toBe("ogg");
  });

  it("maps subtypes that are not extensions", () => {
    /**
     * The bug this replaced: the raw subtype became the extension, and
     * `speech.x-m4a` is refused outright while `speech.mpeg` is a guess.
     */
    expect(audioExtension("audio/x-m4a")).toBe("m4a");
    expect(audioExtension("audio/mpeg")).toBe("mp3");
    expect(audioExtension("AUDIO/WAV")).toBe("wav");
  });

  it("covers every accepted type", () => {
    // An accepted upload with no mapping would silently become ".webm".
    for (const type of ACCEPTED_AUDIO_TYPES) {
      const expected = type === "audio/webm" ? "webm" : undefined;
      const extension = audioExtension(type);
      if (expected) expect(extension).toBe(expected);
      else expect(extension, type).not.toBe("webm");
    }
  });

  it("assumes what Chromium records when it cannot tell", () => {
    expect(audioExtension(undefined)).toBe("webm");
    expect(audioExtension("")).toBe("webm");
    expect(audioExtension("audio/unknown")).toBe("webm");
  });
});

describe("isAcceptedAudioType", () => {
  it("accepts what MediaRecorder produces, parameters and all", () => {
    expect(isAcceptedAudioType("audio/webm;codecs=opus")).toBe(true);
    expect(isAcceptedAudioType("audio/mp4")).toBe(true);
  });

  it("refuses what is not audio", () => {
    expect(isAcceptedAudioType("video/mp4")).toBe(false);
    expect(isAcceptedAudioType("")).toBe(false);
    expect(isAcceptedAudioType(undefined)).toBe(false);
  });
});
