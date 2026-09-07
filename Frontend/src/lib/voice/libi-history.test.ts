import { describe, expect, it } from "vitest";

import {
  boundHistory,
  historyMessages,
  MAX_TURNS,
  MAX_TURN_AGE_MS,
  parseHistory,
  type Turn,
} from "./libi-history";

/**
 * The conversation that lets "תזיז אותו" mean something.
 *
 * ---------------------------------------------------------------------------
 * Two kinds of failure live here and they pull in opposite directions. Too
 * little history and a pronoun resolves to nothing, which the owner
 * experiences as ליבי having forgotten what she said ten seconds ago. Too much
 * and a sentence from an hour ago is still in the prompt — which is worse,
 * because "תבטל אותו" then has *two* things it could mean and the model picks
 * one.
 *
 * The bounds are therefore asserted as behaviour rather than left to the
 * constants, and the age rule is the one to be strict about: it is the only one
 * that can cause the wrong appointment to be touched.
 * ---------------------------------------------------------------------------
 */

const NOW = 1_800_000_000_000;

const turn = (n: number, agoMs = 0): Turn => ({
  said: `שאלה ${n}`,
  replied: `תשובה ${n}`,
  at: NOW - agoMs,
});

describe("boundHistory", () => {
  it("keeps the most recent turns and drops the oldest", () => {
    // A pronoun points backwards a little, not a lot, so the newest end is the
    // part worth the prompt weight.
    const turns = Array.from({ length: MAX_TURNS + 4 }, (_, i) => turn(i));
    const bounded = boundHistory(turns, NOW);

    expect(bounded).toHaveLength(MAX_TURNS);
    expect(bounded[bounded.length - 1].said).toBe(`שאלה ${MAX_TURNS + 3}`);
  });

  it("drops anything older than the window", () => {
    /**
     * **The rule that stops the wrong appointment being cancelled.** A tab left
     * open over lunch and picked up again is a new conversation, and "תבטל
     * אותו" resolved against a sentence from two hours ago is worse than not
     * resolved at all.
     */
    const bounded = boundHistory(
      [turn(1, MAX_TURN_AGE_MS + 1000), turn(2, 5_000)],
      NOW,
    );

    expect(bounded).toHaveLength(1);
    expect(bounded[0].said).toBe("שאלה 2");
  });

  it("keeps a turn that is exactly at the edge of the window", () => {
    expect(boundHistory([turn(1, MAX_TURN_AGE_MS)], NOW)).toHaveLength(1);
  });

  it("drops a turn from the future", () => {
    // A clock that disagrees, or a crafted request. Either way it is not
    // something that was said, and letting it through would make it immortal —
    // it can never age out of the window.
    expect(boundHistory([turn(1, -60_000)], NOW)).toHaveLength(0);
  });

  it("truncates a very long turn rather than dropping it", () => {
    /**
     * The transcript is whatever Whisper returned for twenty seconds of audio,
     * and a crafted request is not bound by convention at all. Trimmed rather
     * than refused: the beginning of a sentence is still a usable reference,
     * and a gap in the conversation is where a pronoun goes wrong.
     */
    const [bounded] = boundHistory(
      [{ said: "א".repeat(5_000), replied: "ב".repeat(5_000), at: NOW }],
      NOW,
    );

    expect(bounded.said.length).toBeLessThan(1_000);
    expect(bounded.replied.length).toBeLessThan(1_000);
  });
});

describe("parseHistory", () => {
  it("reads what the client sends", () => {
    const raw = JSON.stringify([turn(1, 1_000), turn(2)]);
    const parsed = parseHistory(raw, NOW);

    expect(parsed).toHaveLength(2);
    expect(parsed[1].replied).toBe("תשובה 2");
  });

  it("treats an absent or unusable field as no history", () => {
    for (const raw of [undefined, null, "", "not json", "{}", '"a string"', "5"]) {
      expect(parseHistory(raw, NOW), String(raw)).toEqual([]);
    }
  });

  it("drops a malformed conversation whole rather than repairing it", () => {
    /**
     * **A half-parsed conversation is a conversation with a gap in it**, and a
     * gap is exactly where a pronoun resolves to the wrong thing. One bad entry
     * discards the lot: losing the reference costs a repeated sentence, and
     * keeping a mangled one costs the wrong appointment.
     */
    const raw = JSON.stringify([
      turn(1),
      { said: "שאלה", replied: 42, at: NOW },
      turn(3),
    ]);

    expect(parseHistory(raw, NOW)).toEqual([]);
  });

  it("bounds what it accepts, not just what it is given", () => {
    // The client caps this too, and the client is not the one that has to be
    // right — this is the cap that runs on a request that never went near it.
    const raw = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => turn(i)),
    );
    expect(parseHistory(raw, NOW).length).toBe(MAX_TURNS);
  });

  it("applies the age window on the way in", () => {
    const raw = JSON.stringify([turn(1, MAX_TURN_AGE_MS * 4), turn(2)]);
    expect(parseHistory(raw, NOW)).toHaveLength(1);
  });
});

describe("historyMessages", () => {
  it("alternates user and assistant, oldest first", () => {
    /**
     * The shape matters as much as the content: "אותו" resolves against the
     * *previous assistant message*, which is where a chat model looks for it.
     * Flattening the pair into one summary is how that quietly stops working.
     */
    const messages = historyMessages([turn(1, 2_000), turn(2)]);

    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[0].content).toBe("שאלה 1");
    expect(messages[1].content).toBe("תשובה 1");
    expect(messages[3].content).toBe("תשובה 2");
  });

  it("is empty for an empty conversation", () => {
    expect(historyMessages([])).toEqual([]);
  });
});
