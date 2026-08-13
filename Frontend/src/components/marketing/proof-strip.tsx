/**
 * Three claims, immediately under the hero.
 *
 * ---------------------------------------------------------------------------
 * Each one answers an objection rather than describing a feature, which is the
 * difference between copy that converts and copy that lists:
 *
 * - "no downloads for clients" answers *will my customers actually use this* —
 *   the single biggest reason a shop owner says no to booking software;
 * - "a full calendar" answers *what is this for*, in the language of the
 *   outcome rather than the mechanism;
 * - "ready in two minutes" answers *how much of my day will this cost me*.
 *
 * Numbers first and large, because a scanning eye lands on a digit before a
 * word.
 *
 * **It is a card now, not a full-bleed band.** As a band it was a coloured
 * stripe butted against the hero, and the seam between the two read as two
 * sections that happened to be adjacent. Inset on the page background with a
 * blurred halo bleeding out of it, the colour looks like it belongs to the hero
 * above rather than starting again — which is the whole job of the strip that
 * sits between the promise and the proof.
 *
 * **The panel is deep, and carries no pattern.** It used to be `.brand-mesh`
 * under a dot grid: the brand's own mid-toned violet, textured, sitting
 * between two white sections and competing with both the hero above it and the
 * closing banner below — three surfaces in the same violet, one of them
 * speckled. `.obsidian-mesh` is that family taken deep, and the dots are gone
 * entirely. The band now reads as weight rather than as a third announcement.
 * ---------------------------------------------------------------------------
 */

const CLAIMS = [
  {
    value: "0",
    label: "הורדות ללקוח",
    detail: "קובעים תור מהקישור, בלי אפליקציה ובלי הרשמה",
  },
  {
    value: "100%",
    label: "מהיומן במקום אחד",
    detail: "תורים, חסימות וצוות — בלוח שבועי אחד",
  },
  {
    value: "2 דק׳",
    label: "וזה באוויר",
    detail: "שירותים, שעות, קישור לשיתוף. בלי הקמה",
  },
] as const;

export function ProofStrip() {
  return (
    <section className="relative px-5 py-10 sm:px-8 sm:py-14">
      <div className="relative mx-auto w-full max-w-[1400px]">
        {/* The halo. A blurred, scaled-down copy of the card's own colour
            sitting behind it, so the card's edges dissolve into the page
            instead of stopping on a hard line. `-z-10` keeps it behind the
            content without needing a stacking context on every child. */}
        <div
          aria-hidden
          className="obsidian-mesh pointer-events-none absolute inset-x-6 top-6 bottom-6 -z-10 rounded-[2.5rem] opacity-60 blur-2xl"
        />

        {/* No dot pattern. A speckled surface between two clean white sections
            is texture for its own sake, and it was the only thing on the page
            drawing the eye to the *background* of a band whose entire job is to
            carry three numbers. */}
        <div className="obsidian-mesh relative overflow-hidden rounded-3xl shadow-[0_30px_80px_-40px_rgb(9_9_11/0.85)]">
          {/* A hairline of light along the top edge, which is what stops a
              filled panel reading as flat. Bright at the top, gone by the
              middle — the same direction the light comes from everywhere else
              on the page. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-white/50 to-transparent"
          />

          <div className="relative grid gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-4">
            {CLAIMS.map((claim) => (
              <div
                key={claim.label}
                /**
                 * Light glass now, and the direction flipped with the panel.
                 *
                 * On the old mid-toned mesh a white scrim washed the surface
                 * out and cost contrast, so the tiles were darkened instead.
                 * On obsidian there is nothing left to darken — black on black
                 * is a smudge — and a light scrim is what actually reads as
                 * glass catching light.
                 *
                 * Measured at the panel's lightest composite:
                 * `bg-white/[0.08]` gives **9.15:1 for white and 6.00:1 for
                 * `white/75`**, both well clear of AA and both better than the
                 * 7.59 / 5.05 the previous treatment managed. Re-measure before
                 * going lighter.
                 */
                className="rounded-2xl border border-white/15 bg-white/[0.08] p-5 text-center shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] backdrop-blur-md sm:p-6 sm:text-start"
              >
                <p className="text-4xl font-black tracking-tighter text-white tabular-nums sm:text-5xl">
                  {claim.value}
                </p>
                <p className="mt-1 text-sm font-bold text-white">
                  {claim.label}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/75">
                  {claim.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
