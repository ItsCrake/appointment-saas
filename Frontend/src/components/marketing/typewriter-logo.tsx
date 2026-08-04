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
const ACCESSIBLE_NAME = "Bazman — בזמן";

const TYPE_MS = 95;
const DELETE_MS = 45;
const HOLD_MS = 1900;

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
        "text-4xl font-black tracking-tight text-white lg:text-6xl",
        className,
      )}
    >
      {/* The visible text changes character by character, which would make a
          screen reader announce a stream of fragments. It is hidden, and the
          heading exposes one stable name instead. */}
      <span className="sr-only">{ACCESSIBLE_NAME}</span>

      <span aria-hidden dir={PHRASES[index].dir} className="inline-flex">
        {/* min-height keeps the row from collapsing when text is empty
            mid-cycle, so the layout below never jumps. */}
        <span className="min-h-[1.2em]">{text}</span>
        <span
          className={cn(
            "ms-0.5 inline-block w-[0.06em] self-stretch bg-teal-400",
            !reducedMotion && "animate-caret",
          )}
        />
      </span>
    </h1>
  );
}
