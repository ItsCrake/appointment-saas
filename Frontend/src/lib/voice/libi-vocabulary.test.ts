import { describe, expect, it } from "vitest";

import {
  COMMAND_WORDS,
  COURTESY_PHRASES,
  correctHearing,
  MAX_CLIENT_KEYWORDS,
  MAX_KEYWORD_CHARS,
  transcriptionContext,
  transcriptionKeywords,
  whisperPrompt,
} from "./libi-vocabulary";

/**
 * Teaching the transcriber this shop's words.
 *
 * ---------------------------------------------------------------------------
 * **The transcriber is the only step that still has the audio**, so the
 * property that matters is that the diary's own words actually reach it — the
 * client names above all, which the old prompt never carried. A bug here is
 * silent in the worst way: the transcript still comes back fluent, still reads
 * as Hebrew, and simply has somebody else's name in it.
 *
 * Measured on 64 clips before this shape was chosen: keywords and context
 * together recognised 208 of 224 names, verbs and times; keywords alone 202,
 * context alone 177, and the old `whisper-1` prompt 149.
 * ---------------------------------------------------------------------------
 */

const shop = {
  clients: ["ג'ורג' ג'בארין", "ארטיום לבדב", "ברהנו אדמסו"],
  staff: ["ניר בלאק"],
  services: ["תספורת גבר", "עיצוב זקן"],
};

describe("transcriptionKeywords", () => {
  it("carries the clients, the staff and the price list", () => {
    const keywords = transcriptionKeywords(shop);

    for (const word of [...shop.clients, ...shop.staff, ...shop.services]) {
      expect(keywords).toContain(word);
    }
  });

  it("carries the verbs every change begins with", () => {
    const keywords = transcriptionKeywords(shop);
    for (const verb of COMMAND_WORDS) expect(keywords).toContain(verb);
  });

  it("carries the thanks and praise owners say to her", () => {
    /**
     * "מעולה את אלופה" came back as "תלופה מעולה" — two words run into one
     * Hebrew does not have, which the model then looked up as a client. The
     * phrases are keywords now, spelled as they are said.
     */
    const keywords = transcriptionKeywords(shop);
    for (const phrase of ["את אלופה", "מעולה", "תודה רבה"]) {
      expect(keywords).toContain(phrase);
    }
    for (const phrase of COURTESY_PHRASES) expect(keywords).toContain(phrase);
  });

  it("does not prime for a bare 'תודה'", () => {
    // The word the old transcriber invented out of silence. A phrase is a
    // hint; the single common word would be an invitation.
    expect(transcriptionKeywords(shop)).not.toContain("תודה");
  });

  it("never lets the cap trim the thanks", () => {
    const clients = Array.from({ length: 500 }, (_, i) => `לקוח ${i}`);
    expect(transcriptionKeywords({ ...shop, clients })).toContain("את אלופה");
  });

  it("does not carry her own name", () => {
    /**
     * Measured, not assumed: as a keyword "ליבי" was written into a noisy
     * transcript *in place of* the verb — the one word that picks the tool.
     */
    expect(transcriptionKeywords(shop)).not.toContain("ליבי");
  });

  it("caps the clients and keeps the nearest", () => {
    // The list arrives nearest-first, so the cap falls on next fortnight's
    // clients rather than this afternoon's.
    const clients = Array.from(
      { length: MAX_CLIENT_KEYWORDS + 40 },
      (_, i) => `לקוח ${i}`,
    );
    const keywords = transcriptionKeywords({ ...shop, clients });

    expect(keywords).toContain("לקוח 0");
    expect(keywords).toContain(`לקוח ${MAX_CLIENT_KEYWORDS - 1}`);
    expect(keywords).not.toContain(`לקוח ${MAX_CLIENT_KEYWORDS}`);
  });

  it("never lets the cap trim the staff or the services", () => {
    const clients = Array.from({ length: 500 }, (_, i) => `לקוח ${i}`);
    const keywords = transcriptionKeywords({ ...shop, clients });

    expect(keywords).toContain("ניר בלאק");
    expect(keywords).toContain("עיצוב זקן");
  });

  it("drops blanks, repeats and anything too long to be a name", () => {
    // A keyword list containing junk biases toward junk.
    const keywords = transcriptionKeywords({
      clients: ["דנה", "  ", "דנה", "ד", "א".repeat(MAX_KEYWORD_CHARS + 1)],
      staff: ["Dana", "dana"],
      services: [],
    });

    expect(keywords.filter((k) => k === "דנה")).toHaveLength(1);
    expect(keywords.filter((k) => k.toLowerCase() === "dana")).toHaveLength(1);
    expect(keywords).not.toContain("ד");
    expect(keywords.every((k) => k.length <= MAX_KEYWORD_CHARS)).toBe(true);
    expect(keywords.every((k) => k.trim() === k && k.length > 1)).toBe(true);
  });

  it("treats a name typed with two spaces as the same name", () => {
    const keywords = transcriptionKeywords({
      clients: ["ניר  כהן", "ניר כהן"],
      staff: [],
      services: [],
    });
    expect(keywords.filter((k) => k === "ניר כהן")).toHaveLength(1);
  });

  it("stays well inside what the API accepts", () => {
    // ~1000 fields was refused outright; the whole list must stay far below.
    const clients = Array.from({ length: 5000 }, (_, i) => `לקוח ${i}`);
    const services = Array.from({ length: 60 }, (_, i) => `שירות ${i}`);
    const keywords = transcriptionKeywords({ clients, staff: [], services });
    expect(keywords.length).toBeLessThan(300);
  });
});

describe("transcriptionContext", () => {
  it("describes the conversation rather than instructing the model", () => {
    const context = transcriptionContext();

    expect(context).toContain("ליבי");
    expect(context).toContain("תורים");
    // Guidance for this field is context, never a restated task.
    expect(context).not.toMatch(/תמלל|transcrib/i);
  });

  it("carries the question she just asked", () => {
    /**
     * A one-word "כן" is nearly impossible to hear in a loud room with nothing
     * to go on, and trivially likely right after "לבטל אותו?".
     */
    const context = transcriptionContext({
      question: "מצאתי תור של דני מחר ב-14:00. לבטל אותו?",
    });
    expect(context).toContain("לבטל אותו?");
  });

  it("flattens and bounds a question that arrived from the browser", () => {
    const context = transcriptionContext({
      question: `שורה ראשונה\n"ציטוט" ${"מילה ".repeat(200)}`,
    });

    expect(context).not.toContain("\n");
    // Only the quote marks the sentence adds itself.
    expect(context.match(/"/g)).toHaveLength(2);
    expect(context.length).toBeLessThan(400);
  });

  it("speaks about the owner in the owner's own form", () => {
    expect(transcriptionContext({ gender: "female" })).toContain("בעלת העסק");
    expect(transcriptionContext({ gender: "male" })).toContain("בעל העסק");
    expect(transcriptionContext({ gender: "female" })).toContain("מחמיאה לה");
    expect(transcriptionContext({ gender: "male" })).toContain("מחמיא לה");
  });

  it("tells the transcriber she is sometimes thanked", () => {
    // Expected speech is heard as itself; unexpected speech is forced into the
    // nearest word the transcriber was primed for.
    expect(transcriptionContext()).toContain("מודה לה");
  });

  it("adds nothing when there is no question", () => {
    expect(transcriptionContext({ question: "   " })).toBe(
      transcriptionContext(),
    );
  });
});

describe("whisperPrompt", () => {
  it("carries the context and the names, names last", () => {
    /**
     * The fallback model reads roughly the *last* 224 tokens of its prompt, so
     * the names go last where truncation cannot reach them.
     */
    const context = transcriptionContext();
    const prompt = whisperPrompt(context, transcriptionKeywords(shop));

    expect(prompt.startsWith(context)).toBe(true);
    expect(prompt).toContain("ג'ורג' ג'בארין");
    expect(prompt.indexOf("ג'ורג' ג'בארין")).toBeGreaterThan(context.length);
  });

  it("leaves the thanks out of the name list", () => {
    const prompt = whisperPrompt("הקשר.", transcriptionKeywords(shop));
    expect(prompt).not.toContain("את אלופה");
    expect(prompt).not.toContain("תודה רבה");
  });

  it("leaves the verbs out of the name list", () => {
    const prompt = whisperPrompt("", transcriptionKeywords(shop));
    for (const verb of COMMAND_WORDS) expect(prompt).not.toContain(verb);
  });

  it("stops before it grows past what is read", () => {
    const clients = Array.from(
      { length: 150 },
      (_, i) => `לקוח ארוך במיוחד ${i}`,
    );
    const prompt = whisperPrompt(
      transcriptionContext(),
      transcriptionKeywords({ ...shop, clients }),
    );
    expect(prompt.length).toBeLessThanOrEqual(500);
  });

  it("is only the context when there are no names", () => {
    expect(whisperPrompt("הקשר.", [])).toBe("הקשר.");
  });
});

describe("correctHearing", () => {
  it("fixes the mis-hearing the brief named", () => {
    // "קולי" is the word in "תור קולי", and the one this came in about.
    expect(correctHearing("תקבעי תור כהלי לדני")).toBe("תקבעי תור קולי לדני");
  });

  it("fixes the praise the transcriber ran into one word", () => {
    expect(correctHearing("תלופה מעולה")).toBe("את אלופה מעולה");
    expect(correctHearing("מעולה, תלופה!")).toBe("מעולה, את אלופה!");
  });

  it("fixes the verb the transcriber voiced in noise", () => {
    // "תבטלי" came back as "תבדלי" on a clip under clippers.
    expect(correctHearing("תבדלי את התור של ג'ורג'")).toBe(
      "תבטלי את התור של ג'ורג'",
    );
  });

  it("leaves real words and real names alone", () => {
    /**
     * **Why two entries were removed.** "קלי" is a given name and "קולה" is
     * Hebrew; rewriting either into "קולי" renamed a client on the way to the
     * diary. A correction may only ever target a string that is not a word.
     */
    expect(correctHearing("תבטלי את התור של קלי")).toBe("תבטלי את התור של קלי");
    expect(correctHearing("שמעתי את קולה")).toBe("שמעתי את קולה");
  });

  it("leaves a longer word that merely contains one alone", () => {
    /**
     * **The trap this file exists to avoid.** JavaScript defines `\b` against
     * `[A-Za-z0-9_]`, so the obvious boundary does nothing next to Hebrew — a
     * naive replace would rewrite the middle of unrelated words.
     */
    expect(correctHearing("הקליט")).toBe("הקליט");
    expect(correctHearing("תוורדים")).toBe("תוורדים");
    expect(correctHearing("שתבדלים")).toBe("שתבדלים");
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
