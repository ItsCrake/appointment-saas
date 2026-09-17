/**
 * Matching a name the transcriber wrote to a name the diary holds.
 *
 * ---------------------------------------------------------------------------
 * **One letter used to be the difference between an answer and a refusal.**
 * The tools look a spoken name up with `ilike '%name%'`, so "ג'ברין" finds
 * nothing when the diary says "ג'בארין", and "גורג'" nothing when it says
 * "ג'ורג'" — and Hebrew names have several honest spellings before a
 * transcriber gets anywhere near them. This is the second chance: it runs only
 * when the exact lookup found nothing.
 *
 * **Safe because every answer names who it found.** A cancellation or a move
 * reads the diary's own name back and waits for "כן"; a lookup says the name it
 * matched; showing a booking puts it on the screen. A near miss is therefore
 * audible, never silent — the same bargain the ambiguity guard makes.
 *
 * **Conservative where it matters.** Short tokens must match exactly ("דן" is
 * not "דנה"), every token of the query must find its own token in the
 * candidate, and only the best-scoring names are returned — several of them
 * when they tie, which the caller treats as ambiguous and reads back.
 * ---------------------------------------------------------------------------
 */

const FINAL_LETTERS: Record<string, string> = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ",
};

/**
 * A name reduced to what spelling cannot change: no vowel points, no geresh
 * or quotes, no hyphens, final letters folded, lower case, single spaces.
 */
export function nameKey(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[׳״'"`´‘’“”]/g, "")
    .replace(/[-־.,]/g, " ")
    .replace(/[ךםןףץ]/g, (letter) => FINAL_LETTERS[letter])
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A token with its vowel letters taken out after the first letter, and
 * doubled letters collapsed — "ג'בארין" and "ג'ברין", "יוסף" and "יוסי"
 * stripped to their consonants for comparison only.
 */
function skeleton(token: string): string {
  if (token.length < 2) return token;
  const rest = token.slice(1).replace(/[אהוי]/g, "");
  return (token[0] + rest).replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** How many edits a token of this length may absorb. */
function allowance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

/**
 * The cost of reading `heard` as `known`, or `null` when they are different
 * names. Exact is free; a spelling that only differs in its vowel letters is
 * cheap; a typo or two is dearer.
 */
function tokenCost(heard: string, known: string): number | null {
  if (heard === known) return 0;

  const shortest = Math.min(heard.length, known.length);
  // Short tokens are whole names ("דן", "חן", "דנה", "דינה") and one letter is
  // the difference between two people — exact or nothing.
  if (shortest <= 3) return null;

  const direct = levenshtein(heard, known);
  let cost: number | null = direct <= allowance(shortest) ? direct : null;

  const a = skeleton(heard);
  const b = skeleton(known);
  const loose = levenshtein(a, b);
  if (loose <= 1 && (cost === null || loose + 0.5 < cost)) cost = loose + 0.5;

  return cost;
}

/**
 * The cost of the whole query against one candidate: every heard token must
 * claim a distinct known token. Greedy by cheapest pair, which is exact for the
 * one- to three-token names a diary holds.
 */
function nameCost(heard: string[], known: string[]): number | null {
  if (heard.length === 0 || heard.length > known.length) return null;

  const pairs: { h: number; k: number; cost: number }[] = [];
  heard.forEach((token, h) => {
    known.forEach((candidate, k) => {
      const cost = tokenCost(token, candidate);
      if (cost !== null) pairs.push({ h, k, cost });
    });
  });
  pairs.sort((x, y) => x.cost - y.cost);

  const usedHeard = new Set<number>();
  const usedKnown = new Set<number>();
  let total = 0;
  for (const pair of pairs) {
    if (usedHeard.has(pair.h) || usedKnown.has(pair.k)) continue;
    usedHeard.add(pair.h);
    usedKnown.add(pair.k);
    total += pair.cost;
  }

  return usedHeard.size === heard.length ? total : null;
}

/**
 * The diary names a heard name most plausibly means — the best-scoring ones,
 * all of them when they tie, none when nothing is close.
 *
 * `candidates` may repeat; the result does not.
 */
export function matchNames(
  heard: string,
  candidates: readonly string[],
): string[] {
  const heardTokens = nameKey(heard).split(" ").filter(Boolean);
  if (heardTokens.length === 0) return [];

  let best = Number.POSITIVE_INFINITY;
  let matches: string[] = [];

  for (const candidate of new Set(candidates)) {
    const cost = nameCost(
      heardTokens,
      nameKey(candidate).split(" ").filter(Boolean),
    );
    if (cost === null) continue;
    if (cost < best) {
      best = cost;
      matches = [candidate];
    } else if (cost === best) {
      matches.push(candidate);
    }
  }

  return matches;
}
