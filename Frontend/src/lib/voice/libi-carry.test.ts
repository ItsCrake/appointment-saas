import { describe, expect, it } from "vitest";

import { carriedQuestion, parseDraft, parsePending } from "./libi-carry";

/**
 * What the browser hands back between turns.
 *
 * ---------------------------------------------------------------------------
 * These are form fields, so the property worth pinning is that anything
 * malformed comes back **absent** — never half-parsed. A pending action with a
 * missing field would still reach `decide` and be confirmed by a "כן"; a draft
 * with a mangled date would book the wrong day. The authority checks that stop
 * a *well-formed* forgery live elsewhere (`executePending`, `confirmSwap`, the
 * tenant-scoped lookups) and are tested there.
 * ---------------------------------------------------------------------------
 */

const leg = (id: string) => ({
  appointmentId: id,
  clientName: "דנה",
  when: "10:00",
  toWhen: "14:00",
  startsAtIso: "2026-09-04T07:00:00.000Z",
  targetStartsAtIso: "2026-09-04T11:00:00.000Z",
});

describe("parsePending", () => {
  it("reads the three kinds she can ask about", () => {
    const cancel = {
      kind: "cancel",
      appointmentId: "a",
      clientName: "דנה",
      when: "10:00",
      startsAtIso: "2026-09-04T07:00:00.000Z",
    };
    const reschedule = {
      ...cancel,
      kind: "reschedule",
      toWhen: "17:00",
      targetStartsAtIso: "2026-09-04T14:00:00.000Z",
      targetDate: "2026-09-04",
      targetTime: "17:00",
    };
    const swap = { kind: "swap", first: leg("a"), second: leg("b") };

    expect(parsePending(JSON.stringify(cancel))).toEqual(cancel);
    expect(parsePending(JSON.stringify(reschedule))).toEqual(reschedule);
    expect(parsePending(JSON.stringify(swap))).toEqual(swap);
  });

  it("drops anything malformed whole", () => {
    for (const raw of [
      null,
      "",
      "not json",
      "[]",
      JSON.stringify({ kind: "cancel", appointmentId: "a" }),
      JSON.stringify({ kind: "reschedule", appointmentId: "a", clientName: "x", when: "1", startsAtIso: "x" }),
      JSON.stringify({ kind: "swap", first: leg("a") }),
      JSON.stringify({ kind: "swap", first: leg("a"), second: { ...leg("b"), toWhen: 5 } }),
      JSON.stringify({ kind: "delete_everything", appointmentId: "a", clientName: "x", when: "1", startsAtIso: "x" }),
    ]) {
      expect(parsePending(raw), String(raw)).toBeUndefined();
    }
  });

  it("refuses a field too long to be what it claims", () => {
    const cancel = {
      kind: "cancel",
      appointmentId: "a",
      clientName: "ד".repeat(500),
      when: "10:00",
      startsAtIso: "2026-09-04T07:00:00.000Z",
    };
    expect(parsePending(JSON.stringify(cancel))).toBeUndefined();
  });
});

describe("parseDraft", () => {
  it("reads a booking waiting for a detail, and a move waiting for a time", () => {
    const book = {
      kind: "book",
      awaiting: "service",
      name: "דני",
      date: "2026-09-04",
      time: "15:00",
    };
    const move = {
      kind: "move",
      appointmentId: "a",
      clientName: "דנה כהן",
      when: "מחר ב-10:00",
      startsAtIso: "2026-09-04T07:00:00.000Z",
    };

    expect(parseDraft(JSON.stringify(book))).toEqual(book);
    expect(parseDraft(JSON.stringify(move))).toEqual(move);
  });

  it("drops a booking draft without a real day, or waiting for nothing it knows", () => {
    // A mangled date is the one field that would book the wrong day.
    for (const draft of [
      { kind: "book", awaiting: "service", date: "מחר" },
      { kind: "book", awaiting: "service" },
      { kind: "book", awaiting: "colour", date: "2026-09-04" },
      { kind: "book", awaiting: "time", date: "2026-09-04", serviceId: 7 },
      { kind: "move", appointmentId: "a", clientName: "x", when: "y" },
      { kind: "cancel", appointmentId: "a" },
    ]) {
      expect(parseDraft(JSON.stringify(draft)), JSON.stringify(draft)).toBeUndefined();
    }
  });
});

describe("carriedQuestion", () => {
  it("rebuilds the question for a turn that has no history", () => {
    expect(
      carriedQuestion(
        { kind: "swap", first: leg("a"), second: { ...leg("b"), clientName: "רונית" } },
        undefined,
      ),
    ).toBe("להחליף בין דנה לרונית?");
    expect(
      carriedQuestion(undefined, {
        kind: "book",
        awaiting: "staff",
        date: "2026-09-04",
      }),
    ).toBe("אצל מי?");
    expect(carriedQuestion(undefined, undefined)).toBeNull();
  });
});
