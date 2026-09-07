import { describe, expect, it } from "vitest";

import {
  MAX_CHUNKS,
  MIN_SPLIT_CHARS,
  splitForSpeech,
} from "./libi-chunks";

/**
 * Where a reply may be cut so it can start being spoken sooner.
 *
 * ---------------------------------------------------------------------------
 * **The failure that matters is losing words, and it is silent.** Every piece
 * here becomes its own request and its own clip; a bug that drops one takes
 * half an answer with it, and the owner hears a complete-sounding sentence that
 * simply omits the part they asked about. So the property asserted everywhere
 * below is that the pieces still add up to the whole.
 *
 * The second failure is audible rather than silent: a cut in the wrong place
 * arrives as a stutter or a seam mid-clause, which is worse than the wait it
 * was meant to save.
 * ---------------------------------------------------------------------------
 */

/** The pieces, rejoined — must always be the input with seams normalised. */
const rejoin = (parts: string[]) => parts.join(" ");

describe("splitForSpeech", () => {
  it("leaves a short reply whole", () => {
    // Already fast. A second request here would spend a whole round trip to
    // save nothing and add a seam in the middle of six words.
    const short = "אין לך תורים היום.";
    expect(short.length).toBeLessThan(MIN_SPLIT_CHARS);
    expect(splitForSpeech(short)).toEqual([short]);
  });

  it("splits the reply the measurement was taken on", () => {
    /**
     * The live numbers this module exists for: whole, first audio at 3721ms;
     * as two sentences requested together, 1946ms.
     */
    const long =
      "מחר יש לך שלושה תורים. הראשון בשעה תשע וחצי והאחרון בשעה עשר בלילה.";
    const parts = splitForSpeech(long);

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("מחר יש לך שלושה תורים.");
    expect(rejoin(parts)).toBe(long);
  });

  it("keeps the punctuation with the sentence it ends", () => {
    /**
     * A piece ending in "?" is read with the rise that makes it a question,
     * and ליבי's confirmations are questions — "להזיז אותו למחר ב-17:30?".
     * Handing the mark to the next piece would flatten exactly those.
     */
    const asked =
      "מצאתי תור של דניאל כהן מחר בתשע וחצי. להזיז אותו למחר בחמש וחצי?";
    const parts = splitForSpeech(asked);

    expect(parts[0].endsWith(".")).toBe(true);
    expect(parts[parts.length - 1].endsWith("?")).toBe(true);
  });

  it("cuts at the colon that introduces a list", () => {
    /**
     * **The seam most of her replies actually offer.** The concision rules
     * made them a single sentence with a colon in it — no sentence end at all,
     * so nothing was ever cut and the chunking never fired on the answers that
     * are long enough to need it.
     */
    const listed =
      "מחר, בשמונה בספטמבר, יש לך שלושה תורים: הראשון בתשע וחצי והאחרון בעשר בלילה.";
    const parts = splitForSpeech(listed);

    expect(parts).toHaveLength(2);
    expect(parts[0].endsWith(":")).toBe(true);
    expect(rejoin(parts)).toBe(listed);
  });

  it("does not cut a clock time in half", () => {
    /**
     * Times are words by the time the splitter sees them — normalisation runs
     * first — but a colon rule that would have split "17:30" is not one to
     * leave standing on that fact alone. Whitespace after the mark is what
     * keeps it safe.
     */
    const withTime = "התור הבא שלך בשעה 17:30 עם דנה כהן, ואחריו יש לך עוד שניים.";
    for (const part of splitForSpeech(withTime)) {
      expect(part).not.toMatch(/:$/);
    }
    expect(rejoin(splitForSpeech(withTime))).toBe(withTime);
  });

  it("never loses a word, whatever it does", () => {
    /**
     * **The silent failure.** A dropped piece is half an answer, delivered as a
     * sentence that sounds complete — so this is asserted across every shape
     * rather than trusted to the cases above.
     */
    const samples = [
      "אין לך תורים היום.",
      "מחר יש לך שלושה תורים. הראשון בתשע והאחרון בעשר.",
      "רשמתי תור קולי לדני מחר בשלוש. אפשר להוסיף טלפון ביומן כדי לשלוח תזכורת.",
      "כן. לא. אולי. בסדר גמור, נמשיך הלאה עם היום הזה.",
      "משפט בלי סימן בסוף",
    ];

    for (const sample of samples) {
      expect(rejoin(splitForSpeech(sample)), sample).toBe(sample);
    }
  });

  it("does not open with a fragment", () => {
    /**
     * A three-word opener costs a whole request and buys a few hundred
     * milliseconds, and it arrives as an audible stutter before the real
     * sentence — in the one piece the owner is actually waiting for.
     */
    const parts = splitForSpeech(
      "כן. מחר יש לך שלושה תורים, הראשון בתשע וחצי והאחרון בעשר בלילה.",
    );
    expect(parts[0].length).toBeGreaterThan(10);
  });

  it("never returns more pieces than the cap", () => {
    // Each piece is a request, a latency floor and a line in a quota.
    const many = Array.from(
      { length: 12 },
      (_, i) => `משפט מספר ${i} עם קצת טקסט כדי שיהיה ארוך מספיק.`,
    ).join(" ");

    const parts = splitForSpeech(many);
    expect(parts.length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(rejoin(parts)).toBe(many);
  });

  it("puts the overflow in the last piece, not the first", () => {
    // The tail is already playing by the time its length matters; the head is
    // the only piece anybody is waiting on.
    const many = Array.from(
      { length: 8 },
      (_, i) => `משפט מספר ${i} עם קצת טקסט כדי שיהיה ארוך מספיק.`,
    ).join(" ");

    const parts = splitForSpeech(many);
    expect(parts[0].length).toBeLessThan(parts[parts.length - 1].length);
  });

  it("returns nothing for nothing", () => {
    // The caller emits one audio line per piece; an empty answer must produce
    // no request at all rather than a request for silence.
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   ")).toEqual([]);
  });

  it("honours a cap of one", () => {
    const long =
      "מחר יש לך שלושה תורים. הראשון בשעה תשע וחצי והאחרון בשעה עשר בלילה.";
    expect(splitForSpeech(long, 1)).toEqual([long]);
  });
});
