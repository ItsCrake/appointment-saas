import type { AddressGender } from "./libi-address";

/**
 * Teaching the transcriber this shop's words before it guesses at them.
 *
 * ---------------------------------------------------------------------------
 * **The fix for a mis-heard word is not a better prompt downstream — it is a
 * better transcript.** By the time the intent model sees "ג'ברין" the sound is
 * gone; no instruction can recover which name was actually said, and asking a
 * model to guess at a corrupted token is how a booking ends up under a name
 * nobody has. The transcriber is the only step that still has the audio, so it
 * is the step that gets told what to expect.
 *
 * **Two inputs, because `gpt-transcribe` takes two, and each did a different
 * job when measured.** `keywords` carries literal terms — the diary's own
 * client names, the staff, the price list — and is what turned "ג'ברין" into
 * "ג'בארין". The `prompt` carries a sentence about the conversation and is what
 * turned "תבדלי" into "תבטלי": a verb is not a keyword, it is something a
 * listener expects from context. Keywords alone recognised 202 of 224 terms,
 * context alone 177, both together 208.
 *
 * **Client names are the half that matters most**, and until this change they
 * were the half that was missing: nearly every command that changes the diary
 * turns on one ("תבטלי את ג'ורג' ג'בארין"), while the old prompt carried only
 * services and staff. They come from the diary itself — see
 * `upcomingClientNames` — nearest first, so a cap drops next fortnight's
 * clients before this afternoon's.
 *
 * **The old prompt was a comma-separated word list and is gone.** `whisper-1`
 * reads its prompt as the transcript that came *before* the audio, so a list
 * of twenty-six nouns was a strong and unnatural prior — words the owner never
 * says ("שיבוץ", "מרווח") pulling at words they do.
 * ---------------------------------------------------------------------------
 */

/**
 * The verbs every change to the diary begins with.
 *
 * Kept short and feminine, because the owner is talking *to* ליבי: "תבטלי",
 * not "תבטל". Her own name is deliberately not here — as a keyword it was
 * inserted into a noisy transcript *in place of* the verb, which is the one
 * word that decides which tool runs.
 */
export const COMMAND_WORDS = [
  "תבטלי",
  "תזיזי",
  "תקבעי",
  "תרשמי",
  "תראי לי",
] as const;

/**
 * How many client names ride along with one recording.
 *
 * The API refused a form of ~1000 fields and accepted 500; a busy shop's
 * fortnight measured at 101 distinct clients. 150 leaves room for a busier one
 * without growing a request that is sent on every turn.
 */
export const MAX_CLIENT_KEYWORDS = 150;

/** A keyword longer than this is a note, not a name, and is left out. */
export const MAX_KEYWORD_CHARS = 60;

export type VocabularySources = {
  /** Upcoming clients, nearest appointment first. */
  clients: readonly string[];
  staff: readonly string[];
  services: readonly string[];
};

/** Collapses whitespace so "ניר  בלאק" and "ניר בלאק" are one keyword. */
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * The `keywords` for one shop's transcription.
 *
 * Staff and services first, then the verbs, then the clients — the short
 * fixed lists before the long variable one, so the cap only ever trims
 * clients, and trims the furthest away. De-duplicated case-insensitively,
 * because a Latin-script name typed twice is still one name, and anything too
 * short or too long to be a name is dropped: a keyword list containing junk
 * biases toward junk.
 */
export function transcriptionKeywords({
  clients,
  staff,
  services,
}: VocabularySources): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const word = tidy(raw);
    if (word.length < 2 || word.length > MAX_KEYWORD_CHARS) return false;
    const key = word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(word);
    return true;
  };

  for (const name of staff) add(name);
  for (const name of services) add(name);
  for (const word of COMMAND_WORDS) add(word);

  let clientCount = 0;
  for (const name of clients) {
    if (clientCount >= MAX_CLIENT_KEYWORDS) break;
    if (add(name)) clientCount += 1;
  }

  return out;
}

/** The longest question carried into the context, in characters. */
const MAX_QUESTION_CHARS = 200;

/**
 * The `prompt`: what the conversation is, in one sentence, and what ליבי just
 * asked.
 *
 * ---------------------------------------------------------------------------
 * **Described, not instructed.** OpenAI's guidance for this field is context
 * about the recording, never a restatement of the task — "transcribe
 * accurately" is noise here, "a shop owner talking about appointments" is
 * signal.
 *
 * **The last question is the most useful context there is.** A one-word "כן"
 * is nearly impossible to hear in a loud room with nothing to go on, and
 * trivially likely after "לבטל אותו?". Measured, `gpt-transcribe` did not echo
 * the question back into the transcript; `gpt-4o-mini-transcribe` did, word for
 * word, on three noisy clips — which is part of why it is not the model here.
 *
 * The question arrives from the browser, so it is trimmed, flattened to one
 * line and stripped of quote marks before it is embedded. It can only ever
 * shape what the transcriber expects to hear.
 * ---------------------------------------------------------------------------
 */
export function transcriptionContext({
  question,
  gender = "male",
}: {
  question?: string | null;
  gender?: AddressGender;
} = {}): string {
  const who =
    gender === "female"
      ? "בעלת העסק מדברת בעברית עם ליבי, העוזרת הקולית של יומן התורים שלה"
      : "בעל העסק מדבר בעברית עם ליבי, העוזרת הקולית של יומן התורים שלו";

  const sentence = `${who}, על תורים של לקוחות: קביעה, הזזה, ביטול ובדיקה.`;

  const asked = tidy((question ?? "").replace(/["״”“]/g, "")).slice(
    0,
    MAX_QUESTION_CHARS,
  );

  return asked ? `${sentence} ליבי שאלה: "${asked}"` : sentence;
}

/**
 * How much the fallback prompt may carry.
 *
 * `whisper-1` reads roughly the last 224 tokens of a prompt, and Hebrew runs
 * two to four tokens a word in its vocabulary. The names go last, where
 * truncation cannot reach them, and the whole thing stays short enough that
 * the context sentence usually survives too.
 */
const MAX_WHISPER_PROMPT_CHARS = 450;

/**
 * The prompt for `whisper-1`, used only when `gpt-transcribe` fails.
 *
 * `whisper-1` has no `keywords` field, so the names ride in the prompt — as a
 * sentence rather than a bare list, because it reads the prompt as preceding
 * speech and biases toward its *style* as well as its words.
 */
export function whisperPrompt(
  context: string,
  keywords: readonly string[],
): string {
  const names: string[] = [];
  let budget = MAX_WHISPER_PROMPT_CHARS - context.length - 20;

  for (const word of keywords) {
    if ((COMMAND_WORDS as readonly string[]).includes(word)) continue;
    if (word.length + 2 > budget) break;
    names.push(word);
    budget -= word.length + 2;
  }

  return names.length > 0
    ? `${context} שמות ביומן: ${names.join(", ")}.`
    : context;
}

/**
 * Mis-hearings seen in the wild, corrected after the fact.
 *
 * ---------------------------------------------------------------------------
 * **A safety net under the context, not a replacement for it**, and kept
 * deliberately tiny — every entry is a string this product observed being
 * returned, and **none of them is a real word or a name**. "קלי" and "קולה"
 * were here and were removed for exactly that reason: the first is a common
 * given name (Kelly), the second is Hebrew, and rewriting either into "קולי"
 * would have renamed a client on the way to the diary.
 *
 * **Whole words only.** The boundary is written out rather than using `\b`,
 * which JavaScript defines against `[A-Za-z0-9_]` and which therefore does
 * nothing next to Hebrew.
 * ---------------------------------------------------------------------------
 */
const HEARD_AS: Record<string, string> = {
  // "קולי" — the word in "תור קולי", and the one the brief named.
  כהלי: "קולי",
  // "תור" mangled into a spelling Hebrew does not have.
  תוור: "תור",
  // "תבטלי" heard as two words, which then matched no trigger at all.
  "תיבט לי": "תבטלי",
  // "תבטלי" with the ט voiced — returned on a noisy clip by `gpt-transcribe`.
  תבדלי: "תבטלי",
};

const HEBREW = "\\u0590-\\u05FF";

/** Applies the known corrections to a finished transcript. */
export function correctHearing(transcript: string): string {
  let out = transcript;

  for (const [wrong, right] of Object.entries(HEARD_AS)) {
    out = out.replace(
      new RegExp(`(?<![${HEBREW}])${wrong}(?![${HEBREW}])`, "g"),
      right,
    );
  }

  return out;
}
