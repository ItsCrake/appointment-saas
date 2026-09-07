import { describe, expect, it } from "vitest";

import {
  normalizeForSpeech,
  spokenClock,
  spokenDate,
} from "./libi-hebrew";

/**
 * What ליבי says, as opposed to what she writes.
 *
 * ---------------------------------------------------------------------------
 * **Every failure in this file is audible and none of it is visible.** The card
 * still says "17:30" whatever this module does, so a bug here is not something
 * anybody sees in a screenshot or a log — it is a shop owner hearing "one seven
 * three zero" and quietly deciding the feature is not very good.
 *
 * The gendered forms are the part worth being strict about. Hebrew makes number
 * gender agree with the noun, and hours take the feminine while days of the
 * month take the masculine — so "שלוש" and "שלושה" are both correct words and
 * exactly one of them is right in each place. Getting it backwards does not
 * garble the sentence; it produces fluent Hebrew that sounds like a foreigner
 * reading a form, which is precisely what the ElevenLabs switch existed to fix.
 * ---------------------------------------------------------------------------
 */

describe("spokenClock", () => {
  it("names a whole hour with the part of the day", () => {
    // Twelve-hour, because nobody says "seventeen" about a haircut.
    expect(spokenClock(17, 0)).toBe("חמש בערב");
    expect(spokenClock(9, 0)).toBe("תשע בבוקר");
    expect(spokenClock(14, 0)).toBe("שתיים אחר הצהריים");
    expect(spokenClock(22, 0)).toBe("עשר בלילה");
  });

  it("uses the quarter words people actually use", () => {
    expect(spokenClock(9, 30)).toBe("תשע וחצי");
    expect(spokenClock(9, 15)).toBe("תשע ורבע");
  });

  it("reads any other minute as a number", () => {
    expect(spokenClock(17, 45)).toBe("חמש ארבעים וחמש");
    expect(spokenClock(11, 20)).toBe("אחת עשרה עשרים");
  });

  it("drops the part of the day once the minutes have pinned it down", () => {
    // "חמש ועשרים בערב" is how somebody reads a time out; "חמש ועשרים" is how
    // somebody says one, and the extra words buy nothing.
    expect(spokenClock(17, 20)).not.toContain("בערב");
  });

  it("uses feminine hours, because שעה is feminine", () => {
    /**
     * The whole point of the module. "שלושה" is a real Hebrew word and it is
     * the wrong one here — it counts masculine nouns.
     */
    expect(spokenClock(3, 0)).toContain("שלוש");
    expect(spokenClock(3, 0)).not.toContain("שלושה");
    expect(spokenClock(8, 0)).toContain("שמונה");
  });

  it("says twelve rather than zero at either end of the day", () => {
    expect(spokenClock(0, 0)).toBe("שתים עשרה בלילה");
    expect(spokenClock(12, 0)).toBe("שתים עשרה אחר הצהריים");
  });
});

describe("spokenDate", () => {
  it("uses masculine days, because a date does", () => {
    // The mirror of the hour rule, and the reason both are tested: they are
    // adjacent in the same sentence and disagree with each other by design.
    expect(spokenDate(7, 9)).toBe("שבעה בספטמבר");
    expect(spokenDate(3, 1)).toBe("שלושה בינואר");
    expect(spokenDate(21, 12)).toBe("עשרים ואחד בדצמבר");
  });

  it("refuses a date that is not one", () => {
    // Returning "" lets the caller keep the original text rather than saying
    // something confidently wrong.
    expect(spokenDate(32, 9)).toBe("");
    expect(spokenDate(7, 13)).toBe("");
    expect(spokenDate(0, 9)).toBe("");
  });
});

describe("normalizeForSpeech", () => {
  it("rewrites the times in a real sentence", () => {
    expect(normalizeForSpeech("הזזתי את התור של עומר לוי ל-17:30.")).toBe(
      "הזזתי את התור של עומר לוי ל-חמש וחצי.",
    );
  });

  it("rewrites an ISO date and drops the year", () => {
    // She only ever names dates inside a week; the year is four syllables of
    // nothing.
    expect(normalizeForSpeech("מחר, 2026-09-08")).toBe("מחר, שמונה בספטמבר");
  });

  it("reads a slashed or dotted date the way Israel writes one", () => {
    // Day first. "07/09" is the seventh of September, not the ninth of July.
    expect(normalizeForSpeech("ב-07/09")).toBe("ב-שבעה בספטמבר");
    expect(normalizeForSpeech("ב-7.9")).toBe("ב-שבעה בספטמבר");
  });

  it("handles the ISO date before it can be mistaken for a day and month", () => {
    /**
     * `2026-09-08` contains `09-08`, which the day/month rule would happily
     * read as a second date inside the first. Order is what prevents it, and
     * this is the assertion that keeps the order.
     */
    const out = normalizeForSpeech("2026-09-08");
    expect(out).toBe("שמונה בספטמבר");
    expect(out).not.toContain("ספטמבר בספטמבר");
  });

  it("agrees a count with the noun it is counting", () => {
    expect(normalizeForSpeech("יש לך היום 3 תורים")).toBe(
      "יש לך היום שלושה תורים",
    );
    expect(normalizeForSpeech("עוד 45 דקות")).toBe("עוד ארבעים וחמש דקות");
  });

  it("puts two into the construct form a noun requires", () => {
    /**
     * The one number whose counted form differs — "שני תורים", never "שניים
     * תורים" — and the count a diary produces most often after one.
     */
    expect(normalizeForSpeech("יש 2 תורים")).toBe("יש שני תורים");
    expect(normalizeForSpeech("עוד 2 דקות")).toBe("עוד שתי דקות");
  });

  it("leaves a bare number alone", () => {
    /**
     * **The conservative half, and the reason it is conservative.** "45" with
     * no noun after it could be a price, a duration, a house number or a year.
     * A digit read plainly is a small blemish; a confident wrong guess said out
     * loud is the thing that makes somebody stop trusting her.
     */
    expect(normalizeForSpeech("המחיר 45")).toBe("המחיר 45");
    expect(normalizeForSpeech("קוד 7")).toBe("קוד 7");
  });

  it("leaves the word alone when the count is one", () => {
    // Hebrew puts one *after* the noun — "תור אחד" — which is a word-order
    // change rather than a substitution, and `spokenCount` already writes it.
    expect(normalizeForSpeech("יש 1 תור")).toBe("יש 1 תור");
    expect(normalizeForSpeech("יש תור אחד")).toBe("יש תור אחד");
  });

  it("matches a Hebrew noun at the end of a sentence", () => {
    /**
     * **The bug this test exists for.** JavaScript defines `\b` against
     * `[A-Za-z0-9_]`, so `\b` after a Hebrew letter asks for a transition a
     * following space or full stop cannot provide — a pattern written the
     * obvious way silently never matches, and every count stays a digit.
     */
    expect(normalizeForSpeech("יש 3 תורים.")).toContain("שלושה תורים");
    expect(normalizeForSpeech("יש 3 תורים")).toContain("שלושה תורים");
  });

  it("does not touch a longer word that starts with a counted one", () => {
    // "תורים" is a word; it is also the start of others. The boundary has to
    // hold in the direction `\b` was supposed to cover.
    expect(normalizeForSpeech("2 תורימים")).toBe("2 תורימים");
  });

  it("rewrites every occurrence, not just the first", () => {
    expect(normalizeForSpeech("09:30 ואז 17:00")).toBe(
      "תשע וחצי ואז חמש בערב",
    );
  });

  it("points the brand so it is not read as \"in time\"", () => {
    /**
     * **Unpointed בזמן is two words and the wrong one is the common one.**
     * בִּזְמַן is "in time" and the reading any Hebrew speaker — or TTS model —
     * reaches for first; בַּזְמַן is the product. The result is the shop's own
     * assistant mispronouncing the shop's own software, in the one sentence a
     * client might overhear.
     */
    const out = normalizeForSpeech("היי, אני ליבי — העוזרת של בזמן.");
    expect(out).toContain("בַּזְמָן");

    /**
     * **And the stress is on the last syllable — baz-MAN, as in "בול בזמן".**
     * A patah under the final מ is a short vowel Hebrew tends to read as
     * unstressed, which gave BAZ-man: the right vowels with the wrong weight,
     * which is how a brand ends up sounding like a word somebody misread. The
     * qamatz is the long vowel that carries it.
     */
    expect(out).toContain("ָ");
    expect(out, "a patah on the final syllable reads as unstressed").not.toContain(
      "מ" + "ַ" + "ן",
    );
    expect(out).not.toMatch(/בזמן(?![֐-׿])/);
  });

  it("does not point a longer word that merely starts that way", () => {
    // The boundary has to hold in the direction `` cannot express.
    expect(normalizeForSpeech("בזמנים")).toBe("בזמנים");
  });
  it("leaves a sentence with nothing to normalise exactly as it was", () => {
    const plain = "לא מצאתי תורים על השם דנה.";
    expect(normalizeForSpeech(plain)).toBe(plain);
  });

  it("ignores something that only looks like a time", () => {
    // Bounded so a stray pair of digits is not read as a clock.
    expect(normalizeForSpeech("99:99")).toBe("99:99");
  });
});
