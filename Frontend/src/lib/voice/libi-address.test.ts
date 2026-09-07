import { describe, expect, it } from "vitest";

import {
  addressGender,
  ADDRESS_GENDERS,
  DEFAULT_ADDRESS_GENDER,
} from "./libi-address";
import { instructionsFor } from "./libi-voice";

/**
 * Which Hebrew forms ליבי uses for the person she is talking to.
 *
 * ---------------------------------------------------------------------------
 * **The only part of the prompt that differs between two tenants**, which makes
 * it the only part where a wiring mistake is invisible to every check that does
 * not compare the two. A prompt built with the setting ignored still reads
 * perfectly well, still passes a typecheck, and still answers every question —
 * in the wrong gender, out loud, in half the shops.
 * ---------------------------------------------------------------------------
 */

describe("addressGender", () => {
  it("takes the two forms Hebrew actually has", () => {
    for (const gender of ADDRESS_GENDERS) {
      expect(addressGender(gender)).toBe(gender);
    }
  });

  it("is forgiving about what a column or a form holds", () => {
    expect(addressGender("  Female ")).toBe("female");
    expect(addressGender("MALE")).toBe("male");
  });

  it("falls back rather than instructing the model in a gender that does not exist", () => {
    /**
     * The value comes from a settings form and a column that has held a default
     * since 0033. A row written past the app — by hand, by a migration — must
     * produce the default rather than a prompt line nobody wrote.
     */
    for (const junk of ["", "   ", "neutral", "x", null, undefined]) {
      expect(addressGender(junk), JSON.stringify(junk)).toBe(
        DEFAULT_ADDRESS_GENDER,
      );
    }
  });
});

describe("instructionsFor", () => {
  it("says the forms rather than naming the gender", () => {
    /**
     * "Address the owner as female" is an instruction a model can agree with
     * and then drop three words into a sentence. A list of the actual
     * conjugations is one it can copy.
     */
    expect(instructionsFor("female")).toContain("תרצי");
    expect(instructionsFor("male")).toContain("תרצה");
  });

  it("produces genuinely different prompts", () => {
    // The assertion that would have caught the setting being read and then
    // never used — every other check here passes on a prompt that ignores it.
    expect(instructionsFor("female")).not.toBe(instructionsFor("male"));
  });

  it("keeps every rule that is not about gender", () => {
    // The gender half is appended; it must not displace the rest of the prompt.
    for (const gender of ADDRESS_GENDERS) {
      const prompt = instructionsFor(gender);
      expect(prompt).toContain("create_appointment");
      expect(prompt).toContain("show_appointment_in_calendar");
      expect(prompt, "the word cap").toMatch(/15/);
    }
  });
});
