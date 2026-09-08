import { describe, expect, it } from "vitest";

import { correctHearing, transcriptionPrompt } from "./libi-vocabulary";

/**
 * Teaching the transcriber this shop's words.
 *
 * ---------------------------------------------------------------------------
 * **The prompt is the only place a mis-heard word can still be fixed**, so the
 * property that matters is that the shop's own nouns actually reach it. A
 * truncation bug here is silent in the worst way: the transcript still comes
 * back fluent, still looks like Hebrew, and simply has the wrong service name
 * in it.
 * ---------------------------------------------------------------------------
 */

describe("transcriptionPrompt", () => {
  it("carries the shop's own names, which are the half that matters", () => {
    // A general model knows "תור". It has never had reason to learn these.
    const prompt = transcriptionPrompt(["מילוי באקריליק", "ניר בלאק"]);

    expect(prompt).toContain("מילוי באקריליק");
    expect(prompt).toContain("ניר בלאק");
  });

  it("carries the domain words even with no names", () => {
    const prompt = transcriptionPrompt([]);

    expect(prompt).toContain("תור קולי");
    expect(prompt).toContain("ביטול");
    expect(prompt).not.toContain("שירותים ונותני שירות");
  });

  it("puts the shop's names last, where truncation cannot reach them", () => {
    /**
     * Whisper reads roughly the *last* 224 tokens of a prompt, so an over-long
     * one loses its beginning. The half most likely to be cut has to be the
     * half that matters least — and a general Hebrew model already knows "תור"
     * while it has never seen this shop's price list.
     */
    const prompt = transcriptionPrompt(["מילוי באקריליק"]);

    expect(prompt.indexOf("מילוי באקריליק")).toBeGreaterThan(
      prompt.indexOf("ביטול"),
    );
  });

  it("stops before the prompt grows past what is read", () => {
    // A shop with sixty services must not push the domain terms off the front.
    const many = Array.from({ length: 60 }, (_, i) => `שירות ארוך מאוד מספר ${i}`);
    const prompt = transcriptionPrompt(many);

    expect(prompt.length).toBeLessThan(900);
    expect(prompt).toContain("תור קולי");
  });

  it("drops blanks and repeats rather than passing them on", () => {
    // A prompt containing junk biases toward junk.
    const prompt = transcriptionPrompt(["תספורת", "  ", "תספורת", ""]);

    expect(prompt.match(/תספורת/g)).toHaveLength(1);
  });
});

describe("correctHearing", () => {
  it("fixes the mis-hearing the brief named", () => {
    // "קולי" is the word in "תור קולי", and the one this came in about.
    expect(correctHearing("תקבעי תור כהלי לדני")).toBe("תקבעי תור קולי לדני");
  });

  it("leaves a longer word that merely contains one alone", () => {
    /**
     * **The trap this file exists to avoid.** JavaScript defines `\b` against
     * `[A-Za-z0-9_]`, so the obvious boundary does nothing next to Hebrew — a
     * naive replace would rewrite the middle of unrelated words and corrupt
     * legitimate Hebrew into something that still reads as a word.
     */
    expect(correctHearing("הקליט")).toBe("הקליט");
    expect(correctHearing("תוורדים")).toBe("תוורדים");
  });

  it("fixes a word split into two by the transcriber", () => {
    // "תבטלי" came back as "תיבט לי" on a live run, which matched no trigger
    // at all and sent the turn to the wrong tool.
    expect(correctHearing("תיבט לי את התור")).toBe("תבטלי את התור");
  });

  it("leaves a transcript with nothing wrong in it untouched", () => {
    const clean = "כמה תורים יש לי היום?";
    expect(correctHearing(clean)).toBe(clean);
  });

  it("corrects every occurrence, not just the first", () => {
    expect(correctHearing("כהלי וגם כהלי")).toBe("קולי וגם קולי");
  });
});
