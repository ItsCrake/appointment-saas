/**
 * Turning what ליבי writes into what ליבי should say.
 *
 * ---------------------------------------------------------------------------
 * **The card and the voice want different text, and until now they got the
 * same.** "17:30" is exactly right to read — precise, scannable, the format the
 * calendar uses — and wrong to hear: a TTS engine handed digits and a colon
 * reads them as digits and a colon, or as "seventeen thirty", or as "one seven
 * three zero". None of those is how a person says the time of a haircut.
 *
 * So this runs on the way to the speaker and nowhere else. The sentence on the
 * card keeps its numerals; the sentence in the air gets words.
 *
 * **Hebrew makes number gender load-bearing.** Hours agree with שעה, which is
 * feminine — "שלוש", never "שלושה". Days of the month go the other way and
 * take the masculine — "שבעה בספטמבר". Getting it backwards does not produce a
 * different word order, it produces a sentence that sounds like a foreigner
 * reading a form, which is the exact impression this whole ElevenLabs switch
 * exists to avoid.
 *
 * **Conservative on purpose.** Only shapes with one unambiguous reading are
 * rewritten: a clock time, a date, and a count standing in front of a noun this
 * product actually uses. A bare number is left alone, because "45" could be a
 * price, a duration, a house number or a year, and guessing wrong out loud is
 * worse than a digit read plainly.
 * ---------------------------------------------------------------------------
 */

/** 1–19 agreeing with a feminine noun — שעה, דקה. */
const FEMININE = [
  "",
  "אחת",
  "שתיים",
  "שלוש",
  "ארבע",
  "חמש",
  "שש",
  "שבע",
  "שמונה",
  "תשע",
  "עשר",
  "אחת עשרה",
  "שתים עשרה",
  "שלוש עשרה",
  "ארבע עשרה",
  "חמש עשרה",
  "שש עשרה",
  "שבע עשרה",
  "שמונה עשרה",
  "תשע עשרה",
];

/** 1–19 agreeing with a masculine noun — תור, יום. */
const MASCULINE = [
  "",
  "אחד",
  "שניים",
  "שלושה",
  "ארבעה",
  "חמישה",
  "שישה",
  "שבעה",
  "שמונה",
  "תשעה",
  "עשרה",
  "אחד עשר",
  "שנים עשר",
  "שלושה עשר",
  "ארבעה עשר",
  "חמישה עשר",
  "שישה עשר",
  "שבעה עשר",
  "שמונה עשר",
  "תשעה עשר",
];

/** Tens are invariant in both genders. */
const TENS: Record<number, string> = {
  20: "עשרים",
  30: "שלושים",
  40: "ארבעים",
  50: "חמישים",
};

const MONTHS = [
  "",
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

/** 0–59 in words, in the gender the noun it counts requires. */
function spellNumber(value: number, gender: "f" | "m"): string {
  const words = gender === "f" ? FEMININE : MASCULINE;
  if (value < 20) return words[value] ?? String(value);

  const tens = Math.floor(value / 10) * 10;
  const ones = value % 10;
  const tensWord = TENS[tens];
  if (!tensWord) return String(value);

  return ones === 0 ? tensWord : `${tensWord} ו${words[ones]}`;
}

/**
 * Which part of the day an hour belongs to, as a shop would say it.
 *
 * Said only for a whole hour. "חמש בערב" is how somebody names a time; "חמש
 * ועשרים בערב" is how somebody reads one out, and the extra words buy nothing
 * once the minutes have already pinned it down.
 */
function partOfDay(hour24: number): string {
  if (hour24 >= 5 && hour24 < 12) return "בבוקר";
  if (hour24 >= 12 && hour24 < 17) return "אחר הצהריים";
  if (hour24 >= 17 && hour24 < 21) return "בערב";
  return "בלילה";
}

/**
 * A clock time as it is spoken.
 *
 * Twelve-hour, because nobody says "seventeen" about a haircut. The quarters
 * get their own words — "ורבע", "וחצי" — since those are the forms people
 * actually use, and everything else is just the minutes.
 */
export function spokenClock(hour24: number, minute: number): string {
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hour = FEMININE[hour12];

  if (minute === 0) return `${hour} ${partOfDay(hour24)}`;
  if (minute === 15) return `${hour} ורבע`;
  if (minute === 30) return `${hour} וחצי`;

  return `${hour} ${spellNumber(minute, "f")}`;
}

/** A day and month as they are spoken: "שבעה בספטמבר". */
export function spokenDate(day: number, month: number): string {
  const name = MONTHS[month];
  if (!name || day < 1 || day > 31) return "";
  return `${spellNumber(day, "m")} ב${name}`;
}

/**
 * Nouns common enough in her sentences to be worth agreeing with.
 *
 * A count only becomes a word when it is standing in front of one of these.
 * Everywhere else the digits stay, because "45" with no noun after it could be
 * a price, a duration or a year, and a confident wrong guess said out loud is
 * worse than a number read plainly.
 */
/**
 * Two, when it is counting something rather than being said on its own.
 *
 * Hebrew puts the numeral two into the construct state in front of a noun:
 * "שני תורים", never "שניים תורים". It is the one number where the counted
 * form differs, and it is also the count a diary produces most often after one.
 */
const CONSTRUCT_TWO = { f: "שתי", m: "שני" } as const;

/**
 * A count as it is said in front of a noun.
 *
 * One is deliberately left alone: Hebrew puts it *after* the noun — "תור אחד",
 * not "אחד תור" — which is a word-order change rather than a substitution, and
 * `spokenCount` in `libi-speech` already writes it that way, so a "1 תור" never
 * reaches here.
 */
function countWord(value: number, gender: "f" | "m"): string {
  if (value === 1) return "";
  if (value === 2) return CONSTRUCT_TWO[gender];
  return spellNumber(value, gender);
}

/** Anything in the Hebrew block, for boundaries `\b` cannot express. */
const HEBREW_LETTER = "[\\u0590-\\u05FF]";

const COUNTED: { word: string; gender: "f" | "m" }[] = [
  { word: "תורים", gender: "m" },
  { word: "תור", gender: "m" },
  { word: "ימים", gender: "m" },
  { word: "לקוחות", gender: "m" },
  { word: "דקות", gender: "f" },
  { word: "שעות", gender: "f" },
];

/**
 * The whole normalisation, applied in one pass per shape.
 *
 * Order matters: the ISO date is rewritten before the clock, because
 * `2026-09-08` contains no colon but `09-08` would otherwise survive into the
 * date rules and be read as the eighth of September in a string that already
 * said so.
 */
export function normalizeForSpeech(text: string): string {
  let out = text;

  // 2026-09-08 → "שמונה בספטמבר". The year is dropped: she only ever names
  // dates inside a week, and saying it aloud is four syllables of nothing.
  out = out.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (whole, _year: string, month: string, day: string) =>
      spokenDate(Number(day), Number(month)) || whole,
  );

  // 17:30 → "חמש וחצי". Bounded so a stray "1:2" is left alone.
  out = out.replace(
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/g,
    (whole, hour: string, minute: string) =>
      spokenClock(Number(hour), Number(minute)) || whole,
  );

  // 7/9 and 7.9 → "שבעה בספטמבר". Day first: this is an Israeli calendar.
  out = out.replace(
    /\b(\d{1,2})[./](\d{1,2})\b(?!\d)/g,
    (whole, day: string, month: string) =>
      spokenDate(Number(day), Number(month)) || whole,
  );

  /**
   * 3 תורים → "שלושה תורים", 2 דקות → "שתי דקות".
   *
   * **`\b` is useless here and its absence is deliberate.** JavaScript defines
   * a word boundary against `[A-Za-z0-9_]`, so `\b` after a Hebrew letter asks
   * for a transition that a following space cannot provide — the pattern simply
   * never matches. The boundary that is actually meant is "not another Hebrew
   * letter", written out.
   */
  for (const { word, gender } of COUNTED) {
    out = out.replace(
      new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${word})(?!${HEBREW_LETTER})`, "g"),
      (whole, count: string, noun: string) => {
        const spelled = countWord(Number(count), gender);
        return spelled ? `${spelled} ${noun}` : whole;
      },
    );
  }

  return out;
}
