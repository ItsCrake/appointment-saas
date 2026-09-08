import { describe, expect, it } from "vitest";

import { REFUSAL, suppressionFrom } from "./seed-safety";

/**
 * The check that stands between a volume test and a few hundred strangers.
 *
 * ---------------------------------------------------------------------------
 * **The branch worth testing is the one nobody ever sees.** `seed-full-week`
 * creates a week of appointments and queues a notification for each; run with
 * WhatsApp dispatch live, that is messages to phone numbers belonging to people
 * who never booked anything, from an account that does not usually get a second
 * warning.
 *
 * That branch cannot be exercised against the real database without turning
 * dispatch **on** for a moment, on production, with a cron running — which is
 * the exact thing the guard exists to prevent. So the decision is pure and the
 * refusal is asserted here instead.
 *
 * The failure mode to be most afraid of is a guard that reports *suppressed*
 * when it is not, so every ambiguous input below is required to return null.
 * ---------------------------------------------------------------------------
 */

describe("suppressionFrom", () => {
  it("refuses when neither guard is on", () => {
    // The whole point. Null means the seeder throws rather than writes.
    expect(
      suppressionFrom({ platformDisabled: false, envValue: undefined }),
    ).toBeNull();
    expect(
      suppressionFrom({ platformDisabled: null, envValue: undefined }),
    ).toBeNull();
  });

  it("accepts either guard on its own", () => {
    /**
     * OR, matching `whatsappSuppressionReason` in the dispatcher: either source
     * suppresses and neither can force sending back on. Requiring both would be
     * stricter than the product and would refuse in a state where the product
     * genuinely cannot send.
     */
    expect(
      suppressionFrom({ platformDisabled: true, envValue: undefined }),
    ).toBe("master console toggle");

    expect(
      suppressionFrom({ platformDisabled: false, envValue: "true" }),
    ).toBe("DISABLE_WHATSAPP_DISPATCH");
  });

  it("names both when both are on", () => {
    // "It was suppressed" is not a useful thing to read three weeks later when
    // nobody remembers which switch was flipped.
    expect(suppressionFrom({ platformDisabled: true, envValue: "true" })).toBe(
      "master console toggle + DISABLE_WHATSAPP_DISPATCH",
    );
  });

  it("does not read a typo as a guard", () => {
    /**
     * **The dangerous direction.** `DISABLE_WHATSAPP_DISPATCH=ture` looks like
     * protection in a `.env` file and is not, and somebody would rely on it. A
     * value that is not recognisably true has to fall through to the refusal,
     * which is the same rule `env.ts` applies.
     */
    for (const junk of ["ture", "TRUE ", "on", "y", "0", "false", "", "  "]) {
      const reason = suppressionFrom({
        platformDisabled: false,
        envValue: junk,
      });
      // "TRUE " is trimmed and lowercased, so it is the one that does suppress.
      if (junk.trim().toLowerCase() === "true") {
        expect(reason, JSON.stringify(junk)).not.toBeNull();
      } else {
        expect(reason, JSON.stringify(junk)).toBeNull();
      }
    }
  });

  it("takes the spellings an operator actually types", () => {
    for (const yes of ["true", "1", "yes", " True "]) {
      expect(
        suppressionFrom({ platformDisabled: false, envValue: yes }),
        yes,
      ).not.toBeNull();
    }
  });

  it("does not treat a missing platform row as suppression", () => {
    /**
     * `platform_settings` is a singleton, but a fresh database has not got it
     * yet — and "the row is absent" is not "sending is off". Absence has to
     * read as unprotected, or the guard would be weakest on exactly the
     * environments nobody has configured.
     */
    expect(
      suppressionFrom({ platformDisabled: null, envValue: "false" }),
    ).toBeNull();
  });
});

describe("the refusal message", () => {
  it("says what to do about it", () => {
    // A refusal that does not name the fix gets worked around rather than
    // fixed, and the way it gets worked around is by deleting the check.
    expect(REFUSAL).toContain("REFUSING TO SEED");
    expect(REFUSAL).toContain("DISABLE_WHATSAPP_DISPATCH");
    expect(REFUSAL).toContain("/master");
  });
});
