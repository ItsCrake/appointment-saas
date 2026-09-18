import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { libiStatus, LIBI_STAGES, toStage } from "./libi-status";

/**
 * ליבי's status — the orb and the words beside it.
 *
 * The promise is that the words describe what is happening, which is a claim
 * about two files agreeing: the route writes the stages, this maps them. Both
 * halves are pinned here.
 */
describe("libiStatus", () => {
  it("says nothing while she is idle", () => {
    expect(libiStatus("idle", null)).toBeNull();
    expect(libiStatus("idle", "llm")).toBeNull();
  });

  it("walks a full turn in the order the route reports it", () => {
    const labels = [null, ...LIBI_STAGES].map(
      (stage) => libiStatus("processing", stage)?.label,
    );
    expect(labels).toEqual([
      "שומעת…",
      "בודקת ביומן…",
      "חושבת…",
      "מטפלת בזה…",
      "מנסחת תשובה…",
    ]);
    // Every step looks different, so a stuck turn is visibly stuck.
    const orbs = [null, ...LIBI_STAGES].map(
      (stage) => libiStatus("processing", stage)?.orb,
    );
    expect(new Set(orbs).size).toBe(orbs.length);
  });

  it("keeps the instructions for the two moments the owner can act", () => {
    // Listening and speaking are cues — to start talking, or that talking
    // over her works — so their labels say so.
    expect(libiStatus("recording", null)?.label).toContain("אפשר לדבר");
    expect(libiStatus("speaking", null)?.label).toContain("אפשר לקטוע");
  });

  it("speaks of her in the feminine, as everything else about her does", () => {
    for (const stage of [null, ...LIBI_STAGES]) {
      expect(libiStatus("processing", stage)?.label).not.toMatch(/חושב…|בודק /);
    }
  });
});

describe("toStage", () => {
  it("accepts the route's stages and nothing else", () => {
    for (const stage of LIBI_STAGES) expect(toStage(stage)).toBe(stage);
    expect(toStage("auth")).toBeNull();
    expect(toStage(undefined)).toBeNull();
    expect(toStage({ stage: "llm" })).toBeNull();
  });
});

describe("the route and the status agree", () => {
  const route = readFileSync(
    path.resolve(process.cwd(), "src/app/api/voice/process/route.ts"),
    "utf8",
  );
  const voice = readFileSync(
    path.resolve(process.cwd(), "src/lib/voice/libi-voice.ts"),
    "utf8",
  );

  it("opens the stream with what she heard, before deciding anything", () => {
    const heard = route.indexOf('write({ type: "stage", stage: "heard", transcribedText });');
    const decided = route.indexOf("outcome = await decide(");
    expect(heard).toBeGreaterThan(0);
    expect(decided).toBeGreaterThan(heard);
  });

  it("writes every stage `decide` reports, as it reports it", () => {
    expect(route).toContain('write({ type: "stage", stage });');
    // Every stage name `decide` can emit is one this client knows.
    const emitted = [...voice.matchAll(/onStage\?\.\("(\w+)"\)/g)].map(
      (match) => match[1],
    );
    expect(emitted.length).toBeGreaterThan(0);
    for (const stage of emitted) expect(toStage(stage)).toBe(stage);
  });

  it("keeps the empty transcript a refusal rather than a stream", () => {
    // The client's bounded "listen again" lives on the refusal path — see
    // `libi-loop.test.ts` — so an unheard turn must still arrive as one JSON
    // object, before any stream is opened.
    const refusal = route.indexOf('error: "empty_transcript"');
    const stream = route.indexOf("new ReadableStream");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(stream);
  });
});
