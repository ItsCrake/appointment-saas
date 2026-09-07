/**
 * Whether the owner just said yes.
 *
 * ---------------------------------------------------------------------------
 * **This is the gate in front of every destructive write, so it is a pure
 * function and not a prompt.** Asking the model "did they agree?" would put the
 * decision to cancel somebody's appointment behind a sentence that can drift
 * with a model version, a temperature, or a Hebrew phrasing nobody tested. This
 * is a list of words, it is checked by tests, and it changes only when someone
 * changes it.
 *
 * **Unclear is not yes.** Three outcomes rather than a boolean, because the
 * interesting case is neither agreement nor refusal: the owner answered a
 * different question, or the room did. `"unclear"` abandons the pending action
 * and treats the utterance as a fresh turn — which costs one repeated sentence,
 * where guessing costs a client turning up to a shop that is not expecting
 * them. Every ambiguity in this file resolves in that direction.
 *
 * **It only ever runs when something is already pending.** A bare "כן" with
 * nothing awaiting confirmation never reaches here, so the vocabulary can be
 * generous without becoming a hair trigger: the question was asked one turn
 * ago, out loud, naming the client and the time.
 * ---------------------------------------------------------------------------
 */

export type Confirmation = "confirm" | "deny" | "unclear";

/**
 * Hebrew as it is actually spoken to a phone, not as it is written.
 *
 * Whisper returns "כן" for the bare word but routinely returns it inside a
 * sentence — "כן, תזיזי", "בטח, קדימה" — so these are matched as words within
 * the utterance rather than against the whole string.
 */
const CONFIRM_WORDS = [
  "כן",
  "כן כן",
  "אישור",
  "מאשר",
  "מאשרת",
  "אשר",
  "אשרי",
  "תאשרי",
  "בסדר",
  "בטח",
  "כמובן",
  "נכון",
  "יאללה",
  "קדימה",
  "סבבה",
  "מעולה",
  "תעשי",
  "תמשיכי",
  "בבקשה",
  "אוקיי",
  "אוקי",
  "או קיי",
  "ok",
  "okay",
  "yes",
  "yep",
];

/**
 * What Whisper returns when somebody says "כן".
 *
 * ---------------------------------------------------------------------------
 * **"כאן" is not a synonym for yes; it is a mishearing of one**, and a live run
 * caught it on the first try: asked "להזיז אותו להיום ב-17:30?" the owner said
 * "כן" and the transcript came back "כאן". They are near-homophones, this is a
 * one-syllable word answered in a noisy room, and the failure is invisible —
 * she simply asks the same question again, and the owner says the same word,
 * and it happens again.
 *
 * **Matched only as a whole utterance**, which is what makes it safe. "כאן"
 * means *here*, so it can legitimately appear inside a sentence — but a
 * one-word "here" in answer to a yes/no question she just asked out loud is not
 * somebody telling her a location. Inside anything longer it is left alone.
 * ---------------------------------------------------------------------------
 */
const CONFIRM_ALONE = ["כאן", "קן", "כם"];

/**
 * Refusals, and they are checked **first**.
 *
 * "לא, אל תאשרי" contains "אשר". "לא בסדר" contains "בסדר". Every one of these
 * would read as agreement under a naive word scan, and each of them is somebody
 * saying stop.
 *
 * **"בטלי" and "ביטול" are deliberately absent, and that is not an oversight.**
 * They were here, and the test caught what it costs: the pending action is
 * often *a cancellation*, so "כן, תבטלי" — the single most natural way to agree
 * to one — came back as a refusal. The word cancels an appointment; it does not
 * cancel the question. English "cancel" is out for the same reason, since it is
 * the word a Hebrew speaker reaches for about the booking rather than about the
 * conversation. What is left refuses the *conversation* and nothing else.
 */
const DENY_WORDS = [
  "לא",
  "עזבי",
  "עזוב",
  "תעזבי",
  "אל",
  "לא צריך",
  "לא משנה",
  "רגע",
  "חכי",
  "תעצרי",
  "עצור",
  "טעות",
  "no",
  "nope",
  "stop",
];

/**
 * Strips what dictation adds and Hebrew allows, so the word list can stay a
 * word list.
 *
 * Niqqud, the geresh/gershayim a transcriber sometimes emits, and punctuation
 * all come off; the leading ו of "וכן" and the ש of "שכן" do not, deliberately.
 * Chopping prefixes to make more things match is how "שלא" — *that not* —
 * becomes a yes.
 */
function normalise(transcript: string): string[] {
  return transcript
    .replace(/[֑-ׇ]/g, "")
    .replace(/[׳״'"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

/** Word list as a set, and phrases kept whole for a joined-string check. */
const split = (words: readonly string[]) => ({
  single: new Set(words.filter((w) => !w.includes(" "))),
  phrases: words.filter((w) => w.includes(" ")),
});

const CONFIRM = split(CONFIRM_WORDS);
const DENY = split(DENY_WORDS);

function contains(words: string[], joined: string, list: typeof CONFIRM) {
  if (words.some((word) => list.single.has(word))) return true;
  return list.phrases.some((phrase) => joined.includes(phrase));
}

/**
 * How many words an answer may run to and still be an answer.
 *
 * Six covers everything a person actually says at this point — "כן בבקשה
 * תזיזי אותו" is four — while a sentence that carries a new time, a new name
 * or a new question is longer than this and falls through to a fresh turn.
 */
export const MAX_CONFIRM_WORDS = 6;

/**
 * Classifies one answer to a question ליבי has already asked out loud.
 *
 * A long utterance is treated as `"unclear"` even when it contains a yes:
 * somebody who says a whole sentence is starting a new instruction, not
 * answering, and "כן, ומה יש לי מחר?" must not both confirm a cancellation and
 * lose the question.
 */
export function classifyConfirmation(transcript: string): Confirmation {
  const words = normalise(transcript);
  if (words.length === 0) return "unclear";

  const joined = words.join(" ");

  // Refusal wins over agreement wherever both appear. "לא, אל תבטלי" contains
  // a confirm word by accident and a denial on purpose.
  if (contains(words, joined, DENY)) return "deny";

  // The mishearings, and only when they are the entire answer.
  if (words.length === 1 && CONFIRM_ALONE.includes(words[0])) return "confirm";

  if (!contains(words, joined, CONFIRM)) return "unclear";

  /**
   * **A yes has to be short to count.** Past this the owner is talking, not
   * answering — and the cost of reading a new instruction as agreement to the
   * last one is the exact failure this module exists to prevent.
   */
  return words.length <= MAX_CONFIRM_WORDS ? "confirm" : "unclear";
}
