import { describe, expect, it } from "vitest";

import { matchNames, nameKey } from "./libi-names";

/**
 * Reading the transcriber's spelling as the diary's.
 *
 * The pairs here are the ones the benchmark and the live runs produced, plus
 * the ones that must never be read as each other. Every match a tool makes
 * with this is spoken back by name, so a wrong match is audible — but it is
 * still a wrong match, and the second half of this file is what keeps it rare.
 */
const DIARY = [
  "ג'ורג' ג'בארין",
  "אליאס ג'בארין",
  "ארטיום לבדב",
  "ברהנו אדמסו",
  "אלמו טקה",
  "איתן אלקיים",
  "איתן טולדנו",
  "דנה כהן",
  "דינה לוי",
  "דן אברהם",
  "מיכאל פרץ",
  "Dana Levi",
];

describe("nameKey", () => {
  it("folds what spelling can vary", () => {
    expect(nameKey("ג׳ורג׳  ג'בארין")).toBe("גורג גבארינ");
    expect(nameKey("דָּנָה")).toBe("דנה");
    expect(nameKey("בן-חיים")).toBe("בנ חיימ");
    expect(nameKey("  Dana  LEVI ")).toBe("dana levi");
  });
});

describe("matchNames", () => {
  it("finds a name whose vowel letters were dropped", () => {
    // Returned by the transcriber without keywords: "ג'ברין" for "ג'בארין".
    expect(matchNames("ג'ורג' ג'ברין", DIARY)).toEqual(["ג'ורג' ג'בארין"]);
  });

  it("finds a name whose geresh was dropped", () => {
    expect(matchNames("גורג גבארין", DIARY)).toEqual(["ג'ורג' ג'בארין"]);
  });

  it("finds a surname heard with an extra letter", () => {
    // Returned on a clean clip: "ארטיום לוודאב" for "ארטיום לבדב".
    expect(matchNames("ארטיום לוודאב", DIARY)).toEqual(["ארטיום לבדב"]);
  });

  it("finds a first name one letter off", () => {
    // Returned under clippers: "אליס ג'בארין" for "אליאס ג'בארין".
    expect(matchNames("אליס ג'בארין", DIARY)).toEqual(["אליאס ג'בארין"]);
  });

  it("matches a surname alone, and folds case for Latin names", () => {
    expect(matchNames("אדמסו", DIARY)).toEqual(["ברהנו אדמסו"]);
    expect(matchNames("dana levy", DIARY)).toEqual(["Dana Levi"]);
  });

  it("returns every name that fits equally, for the caller to ask about", () => {
    // "איתי" is one letter from both איתנים; guessing between them is the
    // exact thing the ambiguity guard exists to refuse.
    expect(matchNames("איתי", DIARY).sort()).toEqual(
      ["איתן אלקיים", "איתן טולדנו"].sort(),
    );
  });

  it("prefers the closer of two near names", () => {
    expect(matchNames("ג'ורג' ג'בארין", DIARY)).toEqual(["ג'ורג' ג'בארין"]);
  });

  it("never reads one short name as another", () => {
    // Dana is not Dina, and Dan is neither. Short names are whole names.
    expect(matchNames("דנה", ["דינה לוי"])).toEqual([]);
    expect(matchNames("דן", ["דנה כהן"])).toEqual([]);
    expect(matchNames("דינה", ["דנה כהן"])).toEqual([]);
  });

  it("does not stretch to a name that is merely similar in shape", () => {
    expect(matchNames("ברן ארגנטיני", DIARY)).toEqual([]);
    expect(matchNames("משה", DIARY)).toEqual([]);
  });

  it("needs every word of the query to match", () => {
    // A surname the diary does not hold is a different person, even when the
    // first name matches.
    expect(matchNames("ארטיום פבלוב", DIARY)).toEqual([]);
    expect(matchNames("ברהנו אדמסו כהן", DIARY)).toEqual([]);
  });

  it("returns each name once and nothing for nothing", () => {
    expect(matchNames("אלמו טקה", [...DIARY, "אלמו טקה"])).toEqual([
      "אלמו טקה",
    ]);
    expect(matchNames("   ", DIARY)).toEqual([]);
    expect(matchNames("דנה", [])).toEqual([]);
  });
});
