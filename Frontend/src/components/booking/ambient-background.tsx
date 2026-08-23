/**
 * The page's living ground (0027).
 *
 * ---------------------------------------------------------------------------
 * Three slow blobs in the tenant's own accent, drifting behind everything. It
 * is the difference between a page that was printed and one that is switched
 * on, and it costs three empty `<span>`s — every rule that makes it work lives
 * in `globals.css` beside the keyframes, where the performance reasoning
 * belongs.
 *
 * **A server component with no props.** It reads `--accent` from the
 * `data-accent` ancestor at paint time, which is the whole reason the colour
 * system is custom properties rather than classes: this file never learns which
 * shop it is rendering for, and a new swatch needs no change here.
 *
 * **`aria-hidden`, and outside the reading order.** It carries no information —
 * the page says everything it means in text — so a screen reader should never
 * meet it. Motion is answered twice over: the accessibility widget stamps
 * `data-a11y-still` on the root and stops it, and `prefers-reduced-motion`
 * settles it at rest independently. In both cases the *colour* stays, because
 * that is the tenant's identity and only the movement was ever the question.
 * ---------------------------------------------------------------------------
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="ambient">
      <span className="ambient-blob ambient-blob-a" />
      <span className="ambient-blob ambient-blob-b" />
      <span className="ambient-blob ambient-blob-c" />
    </div>
  );
}
