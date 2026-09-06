import { describe, expect, it } from "vitest";

import {
  classifyConfirmation,
  MAX_CONFIRM_WORDS,
} from "./libi-confirm";

/**
 * The word that decides whether somebody's appointment survives.
 *
 * ---------------------------------------------------------------------------
 * Every failure in this file is a write that should not have happened, or a
 * write the owner asked for twice and never got. The first is much worse, so
 * every ambiguous case here asserts that nothing happens — and the tests are
 * written from the direction of "what could a shop floor plausibly produce",
 * not from the direction of the word list, because the word list is the thing
 * under test.
 * ---------------------------------------------------------------------------
 */

describe("classifyConfirmation", () => {
  it("takes yes in the forms people actually say it", () => {
    for (const said of [
      "כן",
      "כן.",
      "כן, תבטלי",
      "בטח",
      "מאשר",
      "אני מאשר",
      "אישור",
      "בסדר",
      "יאללה",
      "קדימה",
      "סבבה",
      "כמובן",
      "אוקיי",
      "או קיי",
      "yes",
    ]) {
      expect(classifyConfirmation(said), said).toBe("confirm");
    }
  });

  it("takes no in the forms people actually say it", () => {
    for (const said of [
      "לא",
      "לא, עזבי",
      "לא משנה",
      "תעזבי",
      "רגע",
      "חכי",
      "עצור",
      "טעות",
      "no",
      "stop",
    ]) {
      expect(classifyConfirmation(said), said).toBe("deny");
    }
  });

  it("agrees to a cancellation phrased as one", () => {
    /**
     * **The collision this file found.** The pending action is very often a
     * cancellation, so "כן, תבטלי" is the most natural way there is to agree to
     * one — and while the cancel verbs sat in the deny list it came back as a
     * refusal, leaving the owner repeating themselves at a phone that had just
     * asked them a yes/no question.
     */
    for (const said of ["כן, תבטלי", "כן ביטול", "בסדר, בטלי"]) {
      expect(classifyConfirmation(said), said).toBe("confirm");
    }
  });
  it("reads a refusal that contains a yes-word as a refusal", () => {
    /**
     * **The one that a naive scan gets backwards, and gets backwards in the
     * expensive direction.** Each of these contains a word from the confirm
     * list and is unambiguously somebody saying stop.
     */
    for (const said of [
      "לא, אל תאשרי",
      "לא בסדר",
      "לא, בטח שלא",
      "לא כן",
    ]) {
      expect(classifyConfirmation(said), said).toBe("deny");
    }
  });

  it("treats a new instruction as a new instruction, not as agreement", () => {
    /**
     * The owner has moved on. Reading "כן" out of a sentence that is plainly a
     * fresh question would both cancel an appointment and lose what was asked —
     * two failures from one greedy match.
     */
    const said = "כן טוב עזבי את זה ותגידי לי מה יש לי מחר בבוקר ביומן";
    expect(said.split(" ").length).toBeGreaterThan(MAX_CONFIRM_WORDS);
    expect(classifyConfirmation(said)).not.toBe("confirm");
  });

  it("is unclear about anything that is not an answer", () => {
    // Silence, a cough transcribed as a word, the room. None of these may
    // confirm, and none of them are a refusal either — they fall through to a
    // fresh turn.
    for (const said of [
      "",
      "   ",
      "מה",
      "אה",
      "תודה",
      "היי ליבי",
      "מה יש לי היום",
    ]) {
      expect(classifyConfirmation(said), JSON.stringify(said)).toBe("unclear");
    }
  });

  it("survives what a transcriber adds", () => {
    // Niqqud, quotes and punctuation arrive from Whisper unpredictably and
    // must not be the difference between a yes and a shrug.
    expect(classifyConfirmation("כֵּן")).toBe("confirm");
    expect(classifyConfirmation('"כן!"')).toBe("confirm");
    expect(classifyConfirmation("כן, בבקשה.")).toBe("confirm");
  });

  it("does not read a prefixed word as the word", () => {
    /**
     * "שלא" is *that not*; "לכן" is *therefore*. Stripping Hebrew prefixes to
     * catch more phrasings is exactly how one of those becomes a yes, so the
     * matcher deliberately does not — and these assert the absence of that
     * cleverness rather than any particular outcome for the words themselves.
     */
    expect(classifyConfirmation("לכן")).toBe("unclear");
    expect(classifyConfirmation("שכן")).toBe("unclear");
  });

  it("never answers anything but the three outcomes", () => {
    // A guard on the shape, since the caller branches on it and a fourth value
    // would silently take the fall-through path.
    for (const said of ["כן", "לא", "מה", ""]) {
      expect(["confirm", "deny", "unclear"]).toContain(
        classifyConfirmation(said),
      );
    }
  });
});
