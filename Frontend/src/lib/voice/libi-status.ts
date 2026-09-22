/**
 * What ליבי is doing, in an orb and a few words.
 *
 * ---------------------------------------------------------------------------
 * **Every word here is something that is actually happening.** The status
 * follows the stream: the route writes a `stage` line as each step of a turn
 * finishes — `heard` once the transcript exists, then `roster`, `llm` and
 * `tool` from `decide` — and each label names the step that *starts* there.
 * A status that cycled through "planning… thinking… solving…" on a timer
 * would look the same and say nothing; this one says where the second went.
 *
 * Nothing here waits on a stage. A turn that skips one — a confirmed "כן"
 * goes from `heard` straight to `tool` — simply shows the next thing it does.
 *
 * Pure, so the mapping is pinned without a browser. The orb's states set the
 * tempo of `.libi-orb` in CSS — see `OrbState`.
 * ---------------------------------------------------------------------------
 */

/** The steps the route reports, in the order a full turn reports them. */
export const LIBI_STAGES = ["heard", "roster", "llm", "tool"] as const;

export type LibiStage = (typeof LIBI_STAGES)[number];

export type LibiPhase = "idle" | "recording" | "processing" | "speaking";

/**
 * How the orb moves. The names are the ones the canvas orb this replaced
 * used, kept so the mapping below reads the same: `listening` turns slowly,
 * the four working states turn briskly, `breathing` — while she speaks — is
 * almost still. See `.libi-orb`.
 */
export type OrbState =
  "listening" | "searching" | "working" | "solving" | "composing" | "breathing";

export type LibiStatus = {
  orb: OrbState;
  label: string;
};

/**
 * A stage line's `stage`, checked — the stream is JSON from the network, and
 * a name this client does not know is shown as no stage at all.
 */
export function toStage(value: unknown): LibiStage | null {
  return LIBI_STAGES.includes(value as LibiStage) ? (value as LibiStage) : null;
}

export function libiStatus(
  phase: LibiPhase,
  stage: LibiStage | null,
): LibiStatus | null {
  switch (phase) {
    case "idle":
      return null;
    case "recording":
      return { orb: "listening", label: "מקשיבה — אפשר לדבר" };
    case "speaking":
      return { orb: "breathing", label: "מדברת — אפשר לקטוע" };
    case "processing":
      break;
  }

  switch (stage) {
    // The recording is on its way up and being transcribed.
    case null:
      return { orb: "listening", label: "שומעת…" };
    // She has the words; the week's diary is what she reads them against.
    case "heard":
      return { orb: "searching", label: "בודקת ביומן…" };
    // The diary is in; the model is working out what was asked.
    case "roster":
      return { orb: "working", label: "חושבת…" };
    // It has decided; the tool is doing it — a lookup, a booking, a move.
    case "llm":
      return { orb: "solving", label: "מטפלת בזה…" };
    // Done; the sentence and the voice are on their way.
    case "tool":
      return { orb: "composing", label: "מנסחת תשובה…" };
  }
}
