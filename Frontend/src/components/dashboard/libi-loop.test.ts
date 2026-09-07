import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The conversation loop, asserted against the source.
 *
 * ---------------------------------------------------------------------------
 * **A source-reading test because the alternative is no test at all.** This
 * repository has no jsdom environment and the loop it needs to check is a
 * `MediaRecorder`, an `AudioContext` and an animation frame — three browser
 * objects and a real microphone. Standing all of that up to assert one
 * `if` would be a large amount of machinery guarding a small amount of code.
 * `calendar-density.test.ts` reads `week-calendar.tsx` for the same reason.
 *
 * **What it is guarding is a bug that shipped.** `play`'s `onended` sets the
 * phase to idle and then immediately asks `start` to take the next turn.
 * `setPhase` is queued; the call is not. So `start` ran inside a closure
 * captured while the phase was still `"speaking"`, hit its own guard, and
 * returned — every conversation stopping dead after ליבי's first answer, with
 * the card still on screen saying she was listening. Nothing failed, nothing
 * logged, and the typechecker was perfectly happy.
 *
 * The fix is a ref, and a ref is invisible: the next person to touch this file
 * has no reason to know that reading `phase` there is different from reading
 * `phaseRef.current`. This is that reason, written down where it will be run.
 * ---------------------------------------------------------------------------
 */

const SOURCE = readFileSync(
  path.resolve(process.cwd(), "src/components/dashboard/libi-assistant.tsx"),
  "utf8",
);

describe("the auto-listen loop", () => {
  it("guards `start` on the ref, not on the rendered phase", () => {
    /**
     * The whole bug in one line. `phase` there is one render stale at exactly
     * the moment it is read, because the only caller sets it and then calls
     * through synchronously.
     */
    expect(SOURCE).toContain('if (phaseRef.current !== "idle") return;');
    expect(SOURCE).not.toMatch(/if \(phase !== "idle"\) return;/);
  });

  it("keeps the rendered phase and the ref written by one function", () => {
    // Two copies of one fact, and the only thing stopping them drifting is
    // that nothing else may write either.
    const assignments = SOURCE.match(/phaseRef\.current =/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(SOURCE).toContain("setPhaseState(next);");
  });

  it("re-opens the microphone from `onended` and nowhere earlier", () => {
    /**
     * The reply reaches the card about three seconds before it finishes being
     * spoken. Re-opening on the *text* would have the analyser hear her own
     * voice through the speaker, latch, and cut the owner off before they had
     * said anything — a bug that looks exactly like a broken microphone.
     */
    const onended = SOURCE.slice(
      SOURCE.indexOf("source.onended"),
      SOURCE.indexOf("source.start()"),
    );
    expect(onended).toContain("startRef.current?.(true)");

    // And it is the only place a turn is continued.
    const continued = SOURCE.match(/startRef\.current\?\.\(true\)/g) ?? [];
    expect(continued).toHaveLength(1);
  });

  it("passes `true` so the continued turn is armed differently", () => {
    /**
     * `continued` decides three things: the card is left alone, the idle
     * timeout is armed, and a conversation is not started twice. Calling with
     * no argument would re-open the microphone with no deadline on it — the
     * twenty-second cap, then the shop sent to Whisper.
     */
    expect(SOURCE).not.toMatch(/startRef\.current\?\.\(\s*\)/);
  });

  it("arms the idle timeout only on a continued turn", () => {
    // A pressed turn has none: the owner meant to speak, and closing the
    // microphone on somebody who is still thinking is the worst thing here.
    expect(SOURCE).toContain("continued ? closeQuietly : undefined");
  });

  it("discards rather than sends when a turn is abandoned", () => {
    // Set before the recorder stops, because `onstop` is where the decision to
    // send is made and it fires on the next tick.
    const close = SOURCE.slice(SOURCE.indexOf("const closeQuietly"));
    const body = close.slice(0, close.indexOf("}, ["));
    expect(body.indexOf("discardRef.current = true")).toBeLessThan(
      body.indexOf("stop()"),
    );
  });
});
