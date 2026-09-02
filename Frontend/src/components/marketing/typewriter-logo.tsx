"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The wordmark in both scripts. `dir` travels with each phrase: "Bazman." is
 * Latin and must run left-to-right even though the page is RTL, or the
 * trailing full stop jumps to the wrong end.
 */
const PHRASES = [
  { text: "Bazman.", dir: "ltr" as const },
  { text: "בזמן.", dir: "rtl" as const },
];

/** Stable text for assistive tech and for anything reading the DOM. */
const ACCESSIBLE_NAME = "Bazman, בזמן";

// Slower than a real typist and slower than the previous pass. The wordmark is
// the only thing on this half of the hero, so the cadence is the composition:
// at 95ms it read as a loading spinner, at 130ms it reads as deliberate.
const TYPE_MS = 130;
const DELETE_MS = 55;
const HOLD_MS = 2400;

type Phase = "typing" | "holding" | "deleting";

export function TypewriterLogo({ className }: { className?: string }) {
  // Starts fully typed, which is also what the server renders — so the first
  // client paint matches the HTML exactly and there is no hydration mismatch.
  const [index, setIndex] = useState(0);
  const [text, setText] = useState(PHRASES[0].text);
  const [phase, setPhase] = useState<Phase>("holding");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // Respecting the preference means holding the first wordmark still, not
    // cycling it faster. `false` on the server keeps SSR deterministic.
    if (reducedMotion) return;

    const full = PHRASES[index].text;

    // Every transition is scheduled rather than applied inline: setting state
    // straight from an effect body re-renders synchronously and trips
    // react-hooks/set-state-in-effect. A zero delay is still a task, so the
    // pure phase flips below are just as safe as the timed ones.
    const [delay, advance]: [number, () => void] =
      phase === "holding"
        ? [HOLD_MS, () => setPhase("deleting")]
        : phase === "deleting"
          ? text.length === 0
            ? [
                0,
                () => {
                  setIndex((current) => (current + 1) % PHRASES.length);
                  setPhase("typing");
                },
              ]
            : [DELETE_MS, () => setText(text.slice(0, -1))]
          : text === full
            ? [0, () => setPhase("holding")]
            : [TYPE_MS, () => setText(full.slice(0, text.length + 1))];

    const timer = setTimeout(advance, delay);
    return () => clearTimeout(timer);
  }, [text, phase, index, reducedMotion]);

  return (
    <h1
      className={cn(
        // Tracking is tightened hard at display size: Heebo set loose at 8xl
        // reads as a default, set tight it reads as a wordmark.
        // Colour is inherited, not asserted. It used to hardcode `text-white`
        // for the dark hero panel, which is precisely what pinned the h1 to
        // that panel — the caller sets it now.
        "text-5xl font-black tracking-tighter sm:text-6xl lg:text-7xl xl:text-8xl",
        className,
      )}
    >
      {/* The visible text changes character by character, which would make a
          screen reader announce a stream of fragments. It is hidden, and the
          heading exposes one stable name instead. */}
      <span className="sr-only">{ACCESSIBLE_NAME}</span>

      <span aria-hidden dir={PHRASES[index].dir} className="inline-flex">
        {/**
         * **The zero-width space is what stops the page moving.**
         *
         * `min-h-[1.2em]` was already here and was not enough, because the jump
         * was never the span collapsing — measured, the heading got 9px *taller*
         * at 390px and 18px taller at 1440 on the frame the text emptied, and
         * the paragraph and CTA below it moved down by exactly that.
         *
         * An inline-flex box takes its baseline from the first line box inside
         * it. With no text there is no line box, so the browser synthesises the
         * baseline from the bottom margin edge instead — the box drops relative
         * to the text baseline and the heading's own line box grows to
         * contain it. The height of the span was never the variable; where it
         * sat on the baseline was.
         *
         * `​` rather than ` `: both restore a line box, but a
         * non-breaking space is a *space*, and it would shove the caret sideways
         * by its own width on the one frame the text is empty — trading a
         * vertical jump for a horizontal one. A zero-width space has a baseline
         * and no advance.
         *
         * `min-h` stays. It is doing nothing on its own now, and it is what
         * holds the row if the font ever loads late or a phrase is added whose
         * glyphs are shorter.
         */}
        <span className="min-h-[1.2em]">{text || "​"}</span>
        {/* The caret takes the heading's own colour, so the mark stays one
            object in light and dark alike. */}
        <span
          className={cn(
            // Follows the text rather than the old panel's paper.
            "ms-1 inline-block w-[0.055em] self-stretch bg-current",
            !reducedMotion && "animate-caret",
          )}
        />
      </span>
    </h1>
  );
}
