/**
 * Cutting a reply into the pieces it can be spoken in.
 *
 * ---------------------------------------------------------------------------
 * **The owner waits for the first word, not for the last one.** ליבי's replies
 * are one or two sentences, and `eleven_v3` charges roughly linearly for them:
 * measured against the live endpoint, the whole of "מחר יש לך שלושה תורים.
 * הראשון בשעה תשע וחצי והאחרון בשעה עשר בלילה." took **3721ms** before a single
 * byte could be played. The same text as two sentences, requested together and
 * played in order, put the first one in the owner's ear at **1946ms** — and
 * finished the lot at 3084ms, so it is not even a trade.
 *
 * That is the whole reason this module exists, and it is why the split is on
 * *sentences* rather than on bytes: each piece has to be a complete MP3 the
 * browser can decode on its own, and it has to end somewhere a person would
 * pause. A cut mid-clause is audible.
 *
 * **Pure, and separate from the speaking.** Where to cut is a property of Hebrew
 * text; how to turn a piece into audio is a property of a provider. Keeping
 * them apart is what lets this be tested without a network.
 * ---------------------------------------------------------------------------
 */

/**
 * How many pieces a reply is worth cutting into.
 *
 * Every piece is its own request — its own latency floor, its own charge, its
 * own row in a quota. Two is where nearly all the benefit is, because the first
 * one is the only one the owner is actually waiting for; three is the ceiling
 * for the rare reply that earns it.
 */
export const MAX_CHUNKS = 3;

/**
 * Below this a reply is not worth splitting.
 *
 * A short sentence is already fast, and cutting "אין לך תורים היום." in two
 * would spend a second request to save nothing and add a seam in the middle of
 * six words.
 */
export const MIN_SPLIT_CHARS = 60;

/**
 * The shortest a *piece* may be.
 *
 * A three-word fragment costs a whole request and buys a few hundred
 * milliseconds, and it arrives as an audible stutter before the real sentence.
 * Anything shorter than this is glued onto its neighbour instead.
 */
const MIN_CHUNK_CHARS = 18;

/**
 * Where a reply may be cut, as Hebrew punctuates it.
 *
 * Full stop, question mark and exclamation — and the split keeps the mark with
 * the sentence it ends, because a piece ending in "?" is read with the rise
 * that makes it a question. Handing the mark to the next piece would flatten
 * exactly the sentences ליבי uses to ask for confirmation.
 *
 * **The colon is here because her sentences turned out to need it.** The
 * concision rules made most replies a single sentence introducing a list —
 * "מחר יש לך שלושה תורים: הראשון ב-09:30 והאחרון ב-22:00" — which has no
 * sentence end in it at all and so was never cut. A colon before a list is
 * where a person pauses anyway, so it is both a safe seam and the only one
 * most replies offer.
 *
 * Whitespace is required after the mark, which is what keeps a clock time out
 * of this. Times are words by the time the splitter sees them — normalisation
 * runs first — but a rule that would have cut "17:30" in half is not one to
 * leave standing on that fact alone.
 */
const SENTENCE_END = /(?<=[.!?:])\s+/;

/**
 * The pieces one reply should be spoken in, in order.
 *
 * Always at least one, and the concatenation is always the input minus the
 * whitespace at the seams — nothing is dropped, so a bug here cannot silently
 * lose half an answer.
 */
export function splitForSpeech(
  text: string,
  maxChunks = MAX_CHUNKS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length < MIN_SPLIT_CHARS || maxChunks < 2) return [trimmed];

  const sentences = trimmed.split(SENTENCE_END).filter(Boolean);
  if (sentences.length < 2) return [trimmed];

  /**
   * Merged forward until every piece is worth its own request, then merged
   * backward from the end until there are few enough of them.
   *
   * Forward first, because a short *opening* fragment is the one that hurts:
   * it is the piece the owner hears first, and a stutter there is the thing
   * this whole module exists to remove.
   */
  const merged: string[] = [];
  for (const sentence of sentences) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.length < MIN_CHUNK_CHARS) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  // Everything past the cap joins the last piece: the tail is already playing
  // by the time it matters, so its size costs nothing that is being waited on.
  if (merged.length > maxChunks) {
    const head = merged.slice(0, maxChunks - 1);
    head.push(merged.slice(maxChunks - 1).join(" "));
    return head;
  }

  return merged;
}
