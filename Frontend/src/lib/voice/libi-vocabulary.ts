/**
 * Teaching the transcriber this shop's words before it guesses at them.
 *
 * ---------------------------------------------------------------------------
 * **The fix for a mis-heard word is not a better prompt — it is a better
 * transcript.** By the time the intent model sees "כהלי" the sound is gone; no
 * instruction downstream can recover which word was actually said, and asking
 * a model to guess at a corrupted token is how a booking ends up under a name
 * nobody has. Whisper takes a `prompt` that biases its decoding toward
 * vocabulary you expect, and that is the only place in this pipeline where the
 * audio is still available to be reconsidered.
 *
 * **The shop's own nouns are the valuable half.** "תור" and "ביטול" are common
 * Hebrew; "מילוי באקריליק" and "ניר בלאק" are not, and they are exactly the
 * words a general model has never had reason to learn. Passing the tenant's
 * real service and staff names is what turns a transcriber that knows Hebrew
 * into one that knows *this diary*.
 *
 * **Bounded, because the prompt is charged for and truncated.** Whisper reads
 * roughly the last 224 tokens of it, so an unbounded list would silently drop
 * the beginning — and the beginning is where the domain terms are. The shop's
 * names go last, where they survive.
 * ---------------------------------------------------------------------------
 */

/**
 * The words this assistant is about, in the forms an owner says them.
 *
 * Written as a sentence rather than a comma list on purpose: Whisper's prompt
 * is treated as *preceding transcript*, so it biases best when it reads like
 * speech. A bag of nouns biases the tokens; a sentence biases the phrasing too.
 */
const DOMAIN_PHRASES = [
  "תור",
  "תורים",
  "תור קולי",
  "קולי",
  "יומן",
  "פנוי",
  "תפוס",
  "מוזמן",
  "ביטול",
  "לבטל",
  "מבוטל",
  "שיבוץ",
  "לשבץ",
  "מרווח",
  "הזזה",
  "להזיז",
  "הוזז",
  "לקבוע",
  "נקבע",
  "לקוח",
  "לקוחה",
  "שירות",
  "נותן שירות",
  "שעה",
  "היום",
  "מחר",
];

/**
 * How much of the prompt the shop's own names may take.
 *
 * Whisper keeps roughly the last 224 tokens. Hebrew runs two to four tokens a
 * word here, so this leaves comfortable room for the domain phrases in front
 * of it without either half crowding the other out.
 */
const MAX_NAME_CHARS = 400;

/**
 * The `prompt` for one shop's transcription.
 *
 * Names are de-duplicated and trimmed, and anything that is not a real word —
 * an empty service name, a stray separator — is dropped rather than passed on,
 * because a prompt containing junk biases toward junk.
 */
export function transcriptionPrompt(names: readonly string[]): string {
  const seen = new Set<string>();
  const clean: string[] = [];
  let budget = MAX_NAME_CHARS;

  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    if (name.length > budget) break;
    seen.add(name);
    clean.push(name);
    budget -= name.length + 2;
  }

  /**
   * The domain first, the shop's nouns last.
   *
   * Whisper reads the *end* of an over-long prompt, so the half most likely to
   * be truncated has to be the half that matters least — and a general Hebrew
   * model already knows "תור" while it has never seen "מילוי באקריליק".
   */
  const parts = [
    `שיחה על יומן תורים במספרה. ${DOMAIN_PHRASES.join(", ")}.`,
    clean.length > 0 ? `שירותים ונותני שירות: ${clean.join(", ")}.` : "",
  ].filter(Boolean);

  return parts.join(" ");
}

/**
 * Mis-hearings seen in the wild, corrected after the fact.
 *
 * ---------------------------------------------------------------------------
 * **A safety net under the prompt, not a replacement for it.** Biasing the
 * decoder is the real fix; this catches what still gets through, and it is
 * kept deliberately tiny — every entry is a word this product observed being
 * mangled, not a word somebody imagined might be.
 *
 * **Whole words only.** "כהלי" is not a Hebrew word and rewriting it is safe;
 * rewriting it *inside* another word would corrupt something legitimate. The
 * boundary is written out rather than using `\b`, which JavaScript defines
 * against `[A-Za-z0-9_]` and which therefore does nothing next to Hebrew.
 * ---------------------------------------------------------------------------
 */
const HEARD_AS: Record<string, string> = {
  // "קולי" — the word in "תור קולי", and the one the brief named.
  כהלי: "קולי",
  קלי: "קולי",
  קולה: "קולי",
  // "תור" mangled into a common but wrong neighbour.
  תוור: "תור",
  // "תבטלי" heard as two words, which then matched no trigger at all.
  "תיבט לי": "תבטלי",
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
