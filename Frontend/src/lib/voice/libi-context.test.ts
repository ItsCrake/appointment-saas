import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TTS_VOICE,
  TTS_VOICES,
  ttsVoice,
} from "./libi-config";
import { buildPromptContext } from "./libi-context";
import type { RosterRow } from "./libi-tools";

/**
 * What ליבי is told before she is asked anything.
 *
 * ---------------------------------------------------------------------------
 * This is the block that lets a model state a fact, which nothing in this
 * feature could do until now — the tools produced every sentence. So the things
 * worth pinning are the ones that would make a *plausible* answer wrong: a time
 * rendered in the server's zone rather than the shop's, a cancelled slot read
 * back as booked, or an empty diary rendered as an empty section that invites
 * the model to fill it.
 * ---------------------------------------------------------------------------
 */
const TZ = "Asia/Jerusalem";
/** Thursday, 12:00 in Jerusalem. */
const NOW = new Date("2026-09-03T09:00:00Z");

const row = (
  iso: string,
  clientName = "דנה כהן",
  serviceName = "תספורת",
  status = "confirmed",
): RosterRow => ({
  startsAt: new Date(iso),
  clientName,
  serviceName,
  status,
});

describe("buildPromptContext", () => {
  it("states the shop's date and time, not the server's", () => {
    /**
     * The half that was simply missing. A model has no clock, so every question
     * containing "היום" or "ביום חמישי" was being resolved by a guess.
     */
    const context = buildPromptContext(NOW, TZ, []);
    expect(context).toContain("2026-09-03");
    expect(context).toContain("12:00");
    expect(context).toContain("חמישי");
    expect(context).toContain(TZ);
  });

  it("uses the shop's clock for the time, not UTC", () => {
    // 09:00Z is 12:00 in Jerusalem. Naming the wrong hour with total confidence
    // is the failure this whole block exists to prevent.
    expect(buildPromptContext(NOW, TZ, [])).not.toContain("09:00");
    expect(buildPromptContext(NOW, "UTC", [])).toContain("09:00");
  });

  it("says the diary is empty rather than leaving a blank section", () => {
    // An absent list is an invitation to invent one.
    const context = buildPromptContext(NOW, TZ, []);
    expect(context).toContain("אין תורים");
  });

  it("renders each appointment with time, client, service and status", () => {
    const context = buildPromptContext(NOW, TZ, [
      row("2026-09-03T11:00:00Z", "דנה כהן", "תספורת וזקן"),
    ]);

    expect(context).toContain("14:00");
    expect(context).toContain("דנה כהן");
    expect(context).toContain("תספורת וזקן");
    expect(context).toContain("confirmed");
  });

  it("counts today separately from the week", () => {
    // "How many today" is the most common question, and making the model count
    // a list it has to filter by date first is asking for an off-by-one.
    const context = buildPromptContext(NOW, TZ, [
      row("2026-09-03T06:00:00Z"),
      row("2026-09-03T11:00:00Z"),
      row("2026-09-05T06:00:00Z"),
    ]);
    expect(context).toContain("תורים היום: 2");
  });

  it("assigns a booking after midnight to the shop's day, not UTC's", () => {
    /**
     * 21:30Z on the 3rd is 00:30 on the 4th in Jerusalem. Counted as today it
     * would tell an owner at breakfast about an appointment they slept through.
     */
    const context = buildPromptContext(NOW, TZ, [row("2026-09-03T21:30:00Z")]);
    expect(context).toContain("תורים היום: 0");
    expect(context).toContain("2026-09-04");
  });

  it("tells the model the list is complete", () => {
    /**
     * Without this the model treats the roster as a sample and hedges — or
     * worse, supplements it. The list really is complete within its window, and
     * saying so is what makes "I do not see it in the diary" an available
     * answer rather than an invented one.
     */
    expect(buildPromptContext(NOW, TZ, [row("2026-09-03T11:00:00Z")])).toContain(
      "אין תורים אחרים",
    );
  });

  it("orders the day before the time on each line", () => {
    // The model reads these as text. A bare "14:00" with no date is the kind of
    // line that gets attributed to today whatever day it belongs to.
    const context = buildPromptContext(NOW, TZ, [row("2026-09-05T06:00:00Z")]);
    expect(context).toMatch(/2026-09-05 \(שבת\) 09:00/);
  });
});

describe("ttsVoice", () => {
  const original = process.env.OPENAI_TTS_VOICE;

  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_TTS_VOICE;
    else process.env.OPENAI_TTS_VOICE = original;
  });

  it("defaults to nova", () => {
    delete process.env.OPENAI_TTS_VOICE;
    expect(ttsVoice()).toBe("nova");
    expect(DEFAULT_TTS_VOICE).toBe("nova");
  });

  it("takes any voice OpenAI actually offers", () => {
    for (const voice of TTS_VOICES) {
      process.env.OPENAI_TTS_VOICE = voice;
      expect(ttsVoice()).toBe(voice);
    }
  });

  it("is forgiving about case and whitespace", () => {
    // It arrives from a `.env` file edited by hand.
    process.env.OPENAI_TTS_VOICE = "  Nova ";
    expect(ttsVoice()).toBe("nova");
  });

  it("falls back rather than sending a voice OpenAI will reject", () => {
    /**
     * An unknown value would come back a 400 from the speech call, which the
     * owner experiences as ליבי having nothing to say — a typo in an
     * environment variable turning into a mute assistant, with the answer still
     * on screen and no clue why it is silent.
     */
    for (const junk of ["", "  ", "NOVA2", "libi", "sk-nope"]) {
      process.env.OPENAI_TTS_VOICE = junk;
      expect(ttsVoice()).toBe(DEFAULT_TTS_VOICE);
    }
  });
});
