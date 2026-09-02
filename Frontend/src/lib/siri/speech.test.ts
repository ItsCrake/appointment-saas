import { describe, expect, it } from "vitest";

import {
  spokenCount,
  spokenDay,
  spokenNext,
  spokenSearch,
  spokenTime,
  spokenToday,
  type SpokenAppointment,
} from "./speech";

/**
 * What Siri says, and the three ways it can be wrong without anything failing.
 *
 * ---------------------------------------------------------------------------
 * A spoken answer has no status code. Every failure here is a sentence that is
 * grammatical, confident and wrong — the wrong hour because a server in another
 * zone answered, "1 תורים" because a numeral was interpolated into a plural, or
 * "you have nothing else today" said to an owner whose next client is at nine
 * tomorrow. None of those throw, none show up in a log, and the only person who
 * finds them is the owner, out loud, in front of a customer.
 * ---------------------------------------------------------------------------
 */
const TZ = "Asia/Jerusalem";

/** 2026-09-03 is a Thursday. Israel is UTC+3 in September (IDT). */
const at = (iso: string): Date => new Date(iso);

const booking = (iso: string, name = "דניאל לוי", service = "תספורת וזקן") =>
  ({ startsAt: at(iso), clientName: name, serviceName: service }) as
    SpokenAppointment;

describe("spokenTime", () => {
  it("names the hour on the shop's clock, not the server's", () => {
    /**
     * The single most damaging bug this feature could ship. 11:00Z is 14:00 in
     * Jerusalem, and a summary built on the server's zone would say "eleven" to
     * an owner whose client arrives at two — a sentence that is fluent, certain
     * and two hours out.
     */
    expect(spokenTime(at("2026-09-03T11:00:00Z"), TZ)).toBe("14:00");
    expect(spokenTime(at("2026-09-03T11:00:00Z"), "UTC")).toBe("11:00");
  });

  it("keeps the leading zero, which is what a clock shows", () => {
    expect(spokenTime(at("2026-09-03T06:05:00Z"), TZ)).toBe("09:05");
  });
});

describe("spokenCount", () => {
  it("says תור אחד for one, never 1 תורים", () => {
    // Hebrew drops the numeral at one and agrees it with the noun above that.
    // "1 תורים" is the shape an interpolated template produces and the shape a
    // listener notices immediately.
    expect(spokenCount(1)).toBe("תור אחד");
  });

  it("uses the numeral from two upwards", () => {
    expect(spokenCount(2)).toBe("2 תורים");
    expect(spokenCount(6)).toBe("6 תורים");
  });

  it("matches how the rest of the product counts appointments", () => {
    // `agenda-view` renders "תור אחד" / "N תורים" for the same noun. The app
    // and the assistant describing one day differently is the kind of seam an
    // owner reads as a bug in both.
    expect(spokenCount(1)).toContain("אחד");
    expect(spokenCount(3)).toMatch(/^3 תורים$/);
  });
});

describe("spokenDay", () => {
  const now = at("2026-09-03T09:00:00Z"); // Thursday 12:00 IDT

  it("says nothing for today", () => {
    // "The next appointment today at two" is longer without being clearer.
    expect(spokenDay(at("2026-09-03T15:00:00Z"), now, TZ)).toBe("");
  });

  it("says מחר for tomorrow", () => {
    expect(spokenDay(at("2026-09-04T06:00:00Z"), now, TZ)).toBe("מחר");
  });

  it("names the weekday within the week", () => {
    // Sunday the 6th.
    expect(spokenDay(at("2026-09-06T06:00:00Z"), now, TZ)).toBe("ביום ראשון");
  });

  it("adds the date once a weekday alone is ambiguous", () => {
    // Past seven days "ביום שלישי" could be any of several Tuesdays.
    const spoken = spokenDay(at("2026-09-22T06:00:00Z"), now, TZ);
    expect(spoken).toContain("22");
    expect(spoken).toContain("ספטמבר");
  });

  it("decides the day in the shop's zone, not UTC", () => {
    /**
     * 21:30Z on the 3rd is already 00:30 on the 4th in Jerusalem. A booking at
     * that instant is tomorrow to the owner and today to the server, and the
     * word "מחר" is the whole difference.
     */
    expect(spokenDay(at("2026-09-03T21:30:00Z"), now, TZ)).toBe("מחר");
    expect(spokenDay(at("2026-09-03T21:30:00Z"), now, "UTC")).toBe("");
  });
});

describe("spokenNext", () => {
  const now = at("2026-09-03T09:00:00Z");

  it("names the time, the client and the service", () => {
    expect(spokenNext(booking("2026-09-03T11:00:00Z"), now, TZ)).toBe(
      "התור הבא שלך בשעה 14:00 עם דניאל לוי (תספורת וזקן).",
    );
  });

  it("names the day when it is not today", () => {
    /**
     * The brief's fallback line is "אין לך תורים נוספים להיום", and the query
     * behind this is deliberately not limited to today: an owner asking at
     * seven in the evening is better served by "tomorrow at nine" than by
     * being told, truthfully and uselessly, that today is over.
     */
    const spoken = spokenNext(booking("2026-09-04T06:00:00Z"), now, TZ);
    expect(spoken).toContain("מחר");
    expect(spoken).toContain("09:00");
  });

  it("falls back to the brief's line on an empty calendar", () => {
    expect(spokenNext(null, now, TZ)).toBe("אין לך תורים נוספים להיום.");
  });

  it("never leaves a double space where the day is omitted", () => {
    // The day is an empty string for today, and the sentence is assembled by
    // joining parts — so today's answer is the one that would carry the seam.
    expect(spokenNext(booking("2026-09-03T11:00:00Z"), now, TZ)).not.toMatch(
      /\s{2}/,
    );
  });
});

describe("spokenToday", () => {
  it("gives the count and the next time", () => {
    expect(spokenToday(6, booking("2026-09-03T07:00:00Z"), TZ)).toBe(
      "יש לך היום 6 תורים ביומן. התור הקרוב בשעה 10:00.",
    );
  });

  it("says so when the day is empty", () => {
    expect(spokenToday(0, null, TZ)).toBe("אין לך תורים היום.");
  });

  it("does not use the future tense once the day is behind them", () => {
    /**
     * The "past business hours" case. A shop that had six appointments and has
     * finished them all is not a shop with six appointments — telling an owner
     * locking up that they "have six today" is a small lie of tense, and the
     * one they are most likely to hear, because the evening is when people ask.
     */
    const spoken = spokenToday(6, null, TZ);
    expect(spoken).toContain("6 תורים");
    expect(spoken).toContain("מאחוריך");
    expect(spoken).not.toContain("הקרוב");
  });

  it("agrees the count for a single booking", () => {
    expect(spokenToday(1, booking("2026-09-03T07:00:00Z"), TZ)).toContain(
      "תור אחד",
    );
  });
});

describe("spokenSearch", () => {
  const now = at("2026-09-03T09:00:00Z");

  it("names the one match", () => {
    const spoken = spokenSearch(
      "דניאל",
      [booking("2026-09-04T06:00:00Z")],
      now,
      TZ,
    );
    expect(spoken).toContain("תור אחד");
    expect(spoken).toContain("מחר");
    expect(spoken).toContain("09:00");
  });

  it("names the nearest and counts the rest rather than listing them", () => {
    // Nobody retains a spoken list of five times; the app is where a list
    // belongs.
    const spoken = spokenSearch(
      "דניאל",
      [
        booking("2026-09-04T06:00:00Z"),
        booking("2026-09-08T06:00:00Z"),
        booking("2026-09-15T06:00:00Z"),
      ],
      now,
      TZ,
    );
    expect(spoken).toContain("3 תורים");
    expect(spoken).toContain("הקרוב");
    expect(spoken).not.toContain("15");
  });

  it("echoes the name back on a miss", () => {
    /**
     * The common failure here is dictation, not data. Hearing "לא מצאתי תורים
     * על השם דני אל" tells the owner instantly that Siri split the name, where
     * a bare "not found" sends them to look for a bug in the calendar.
     */
    expect(spokenSearch("דני אל", [], now, TZ)).toBe(
      "לא מצאתי תורים על השם דני אל.",
    );
  });
});

describe("every spoken string is fit to be heard", () => {
  const now = at("2026-09-03T09:00:00Z");
  const all = [
    spokenNext(booking("2026-09-03T11:00:00Z"), now, TZ),
    spokenNext(null, now, TZ),
    spokenToday(6, booking("2026-09-03T07:00:00Z"), TZ),
    spokenToday(0, null, TZ),
    spokenToday(6, null, TZ),
    spokenSearch("דניאל", [booking("2026-09-04T06:00:00Z")], now, TZ),
    spokenSearch("דניאל", [], now, TZ),
  ];

  it.each(all)("ends in a full stop: %s", (spoken) => {
    // A sentence without one runs into whatever the Shortcut says next.
    expect(spoken.trim()).toMatch(/[.?]$/);
  });

  it.each(all)("carries no stray whitespace: %s", (spoken) => {
    expect(spoken).toBe(spoken.trim());
    expect(spoken).not.toMatch(/\s{2}/);
  });

  it.each(all)("is short enough to be heard in one breath: %s", (spoken) => {
    // Siri reads roughly 15 characters a second in Hebrew; past ~140 the owner
    // has stopped listening and the useful part was at the start.
    expect(spoken.length).toBeLessThan(140);
  });
});
