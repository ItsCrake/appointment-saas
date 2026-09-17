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
    // Assignments only: the handlers compare it with `===`, which is reading.
    const assignments = SOURCE.match(/phaseRef\.current =(?!=)/g) ?? [];
    expect(assignments).toHaveLength(1);
    expect(SOURCE).toContain("setPhaseState(next);");
  });

  it("re-opens the microphone on the last clip and nowhere earlier", () => {
    /**
     * The reply reaches the card seconds before it finishes being spoken, so
     * re-opening on the *text* would have the analyser hear her own voice
     * through the speaker, latch, and cut the owner off before they had said
     * anything — a bug that looks exactly like a broken microphone.
     *
     * **The trigger moved when the reply became several clips.** It used to sit
     * in `play`'s `onended`, which was right while there was exactly one; with
     * a queue that would reopen the microphone after the *first* sentence, with
     * two more still to play into it. Only the loop reading the stream knows
     * which clip is the last, so the guard moved there with it.
     */
    expect(SOURCE).toContain("if (message.last) {");

    const guarded = SOURCE.slice(SOURCE.indexOf("if (message.last) {"));
    expect(guarded.slice(0, 200)).toContain("continueConversation()");

    // One function starts a turn from a turn…
    const continued = SOURCE.match(/startRef\.current\?\.\(true\)/g) ?? [];
    expect(continued).toHaveLength(1);
    const helper = SOURCE.slice(SOURCE.indexOf("const continueConversation"));
    expect(helper.slice(0, 200)).toContain("startRef.current?.(true)");

    // …the text line never calls it…
    const text = SOURCE.slice(
      SOURCE.indexOf('if (message.type === "text") {'),
      SOURCE.indexOf("One clip of the reply"),
    );
    expect(text).not.toContain("continueConversation()");

    // …and it has exactly two callers: the last clip, and an unheard turn.
    expect(SOURCE.match(/continueConversation\(\);/g) ?? []).toHaveLength(2);
  });

  it("listens again after an unheard turn, a bounded number of times", () => {
    /**
     * An empty transcript is the transcriber saying it could not make the
     * words out over the room. The question it answered is still pending, so
     * the microphone re-opens — but a room that produces nothing but empty
     * transcripts must not keep it, and the bill, running forever.
     */
    const refusal = SOURCE.slice(SOURCE.indexOf("const refusal ="));
    const body = refusal.slice(0, refusal.indexOf("return;"));
    expect(body).toContain('refusal.error === "empty_transcript"');
    expect(body).toContain("unheardRef.current < MAX_UNHEARD_TURNS");
    expect(body).toContain("endConversation()");
  });

  it("never writes idle over the next turn when the stream ends", () => {
    /**
     * After the last clip the phase may already belong to the next turn. The
     * old fallback set "idle" after the loop whenever nothing had been spoken
     * aloud — over a recording that had just started, with the microphone
     * still open behind it.
     */
    expect(SOURCE).toContain("if (!sawLast) {");
    expect(SOURCE).not.toMatch(/if \(!spokeAloud\) setPhase\("idle"\)/);
  });

  it("waits for each clip to finish before starting the next", () => {
    /**
     * `play` used to resolve at `source.start()`, so awaiting it meant nothing.
     * With a queue that is two sentences talking over each other.
     */
    const body = SOURCE.slice(
      SOURCE.indexOf("const play = useCallback"),
      SOURCE.indexOf("const interrupt = useCallback"),
    );
    expect(body).toMatch(
      /source\.onended = \(\) => \{[\s\S]{0,160}resolve\(\);/,
    );
  });

  it("lets the owner talk over her", () => {
    /**
     * The button used to be disabled while she spoke, so an answer the owner
     * had already understood still had to be sat through. A press now stops
     * the clip and opens the microphone in the same gesture.
     */
    expect(SOURCE).toContain('disabled={phase === "processing"}');
    const button = SOURCE.slice(SOURCE.indexOf("onPointerDown="));
    const down = button.slice(0, button.indexOf("onPointerUp="));
    expect(down).toContain('if (phaseRef.current === "speaking") interrupt();');
    expect(down.indexOf("interrupt()")).toBeLessThan(down.indexOf("start()"));

    const interrupt = SOURCE.slice(
      SOURCE.indexOf("const interrupt = useCallback"),
    );
    const body = interrupt.slice(0, interrupt.indexOf("}, ["));
    expect(body).toContain("turnRef.current += 1");
    expect(body).toContain("source?.stop()");
    expect(body).toContain('setPhase("idle")');
  });

  it("never lets an answer that was talked over touch the next turn", () => {
    /**
     * The reading loop outlives the interruption: the stopped clip still ends,
     * and more lines may still arrive. Each check sits before the loop writes
     * the phase or continues the conversation, or the stale answer would
     * write "idle" over the recording that replaced it.
     */
    const send = SOURCE.slice(SOURCE.indexOf("const send = useCallback"));
    expect(send.slice(0, 200)).toContain("const turn = ++turnRef.current;");
    const guards = send.match(/if \(turn !== turnRef\.current\) \{/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);

    const last = send.indexOf("if (message.last) {");
    const guardBeforeLast = send.lastIndexOf(
      "if (turn !== turnRef.current) {",
      last,
    );
    expect(guardBeforeLast).toBeGreaterThan(send.indexOf("await play("));
    expect(guardBeforeLast).toBeLessThan(last);
  });

  it("speaks a little faster, at the same pitch", () => {
    // Through the stretch, never through `playbackRate`, which would raise
    // her voice with her speed.
    expect(SOURCE).toContain("timeStretch(");
    expect(SOURCE).not.toMatch(/playbackRate/);
  });

  it("passes `true` so the continued turn is armed differently", () => {
    /**
     * `continued` decides four things: the card is left alone, the short
     * idle window applies and may discard, the cap is lower, and a
     * conversation is not started twice. Calling with no argument would
     * re-open the microphone as if the owner had pressed it.
     */
    expect(SOURCE).not.toMatch(/startRef\.current\?\.\(\s*\)/);
  });

  it("gives a pressed turn the patient idle rule, and never a discard", () => {
    /**
     * A turn that opened by itself gets the short window and may be thrown
     * away when nothing happened in it. A pressed one waits longer and then
     * *sends*: the owner meant to speak, and a voice too buried in the room
     * to detect is still worth transcribing.
     */
    expect(SOURCE).toContain("idleMs: continued ? IDLE_MS : PRESSED_IDLE_MS");
    expect(SOURCE).toMatch(
      /onIdle: continued\s*\?[\s\S]{0,120}closeQuietly\(\)\)\s*:\s*stop,/,
    );
  });

  it("keeps one microphone for the whole conversation", () => {
    /**
     * The stream used to be released after every recording and opened again
     * for the next, and the owner's first syllable — the verb that picks the
     * tool — went into a device that was still starting. It is opened in one
     * place, with the voice-processing constraints, and released only when
     * the conversation ends.
     */
    expect(SOURCE.match(/mediaDevices\.getUserMedia\(\{/g) ?? []).toHaveLength(
      1,
    );
    expect(SOURCE).toMatch(
      /getUserMedia\(\{\s*audio: AUDIO_CONSTRAINTS,?\s*\}\)/,
    );

    const onstop = SOURCE.slice(SOURCE.indexOf("recorder.onstop = () => {"));
    const stopBody = onstop.slice(0, onstop.indexOf("void send(blob);"));
    expect(stopBody).not.toContain("releaseStream()");

    const end = SOURCE.slice(SOURCE.indexOf("const endConversation"));
    expect(end.slice(0, end.indexOf("}, ["))).toContain("releaseStream()");
  });

  it("lets a held button overrule the silence detector", () => {
    // While the owner holds the button, letting go ends the turn — not a
    // pause the detector heard in the middle of a sentence.
    const tick = SOURCE.slice(SOURCE.indexOf("const tick = () => {"));
    const body = tick.slice(
      0,
      tick.indexOf("frame = requestAnimationFrame(tick);"),
    );
    expect(body).toContain("if (!holdingRef.current) {");
    expect(body.indexOf("if (!holdingRef.current) {")).toBeLessThan(
      body.indexOf("onSilent()"),
    );
  });

  it("keeps the last syllable when the owner stops by hand", () => {
    /**
     * People let go on the last syllable, and the last syllable of a Hebrew
     * command is the name or the time. Every manual stop goes through the
     * half-second tail; none calls `stop()` directly.
     */
    const button = SOURCE.slice(SOURCE.indexOf("onPointerDown="));
    const handlers = button.slice(0, button.indexOf("disabled="));
    expect(handlers).toContain("finishSoon()");
    expect(handlers).not.toMatch(/[^.\w]stop\(\)/);
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

  it("arms the discard only when something is recording", () => {
    /**
     * Closing the card while ליבי was speaking used to set the flag with
     * nothing to discard — and the next question the owner asked, a minute
     * later, was the thing thrown away.
     */
    const close = SOURCE.slice(SOURCE.indexOf("const closeQuietly"));
    const body = close.slice(0, close.indexOf("}, ["));
    expect(body).toContain(
      'if (recorderRef.current?.state === "recording") discardRef.current = true;',
    );
    // And every new turn starts with it clear.
    const start = SOURCE.slice(SOURCE.indexOf("const start = useCallback"));
    expect(start.slice(0, 2500)).toContain("discardRef.current = false;");
  });
});
