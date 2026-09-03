import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

import { runVoiceTool, VOICE_TOOLS, type ToolContext } from "./libi-tools";

/**
 * What the assistant is allowed to do to a calendar.
 *
 * ---------------------------------------------------------------------------
 * The read tools are ordinary queries and are tested as such. The one that
 * matters is `propose_cancel_appointment`, and what it is tested for is that it
 * **does not cancel anything** — the row is still bookable afterwards. That is
 * the whole safety position of this feature: the input is Hebrew speech
 * transcribed by a model in a room with clippers running, and `בטל` and `בדוק`
 * differ by one consonant. A wrong read costs a sentence; a wrong write costs a
 * client turning up to a shop that is not expecting them.
 * ---------------------------------------------------------------------------
 */
let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

const TZ = "Asia/Jerusalem";
/** Thursday, 12:00 in Jerusalem. */
const NOW = new Date("2026-09-03T09:00:00Z");

async function shop() {
  const business = await createBusiness(db, { timezone: TZ });
  const service = await createService(db, business.id, { durationMin: 30 });
  const ctx: ToolContext = {
    db,
    businessId: business.id,
    timezone: TZ,
    now: NOW,
  };
  return { business, service, ctx };
}

async function book(
  s: Awaited<ReturnType<typeof shop>>,
  startsAt: string,
  clientName: string,
  overrides: Parameters<typeof createAppointment>[5] = {},
) {
  const from = new Date(startsAt);
  return createAppointment(
    db,
    s.business.id,
    s.service.id,
    from,
    new Date(from.getTime() + 30 * 60_000),
    { clientName, ...overrides },
  );
}

describe("the tool surface", () => {
  it("offers no tool that writes", () => {
    /**
     * Stated as a test rather than as a comment, because the next tool somebody
     * adds is the one that will not be reviewed with this in mind. A name
     * containing `cancel`, `create`, `update` or `delete` without `propose_` in
     * front of it is a voice channel that can change a client's day on a
     * mis-hearing.
     */
    for (const tool of VOICE_TOOLS) {
      const name = tool.function.name;
      if (/cancel|create|update|delete|reschedule|book/.test(name)) {
        expect(name, `${name} must be a proposal`).toMatch(/^propose_/);
      }
    }
  });

  it("describes every tool in Hebrew, which is what the model matches on", () => {
    // The utterances are Hebrew; a description in English asks the model to
    // translate before it can choose.
    for (const tool of VOICE_TOOLS) {
      expect(tool.function.description).toMatch(/[֐-׿]/);
    }
  });
});

describe("get_next_appointment", () => {
  it("names the soonest one after now", async () => {
    const s = await shop();
    await book(s, "2026-09-03T06:00:00Z", "כבר עבר");
    await book(s, "2026-09-03T11:00:00Z", "דניאל");
    await book(s, "2026-09-05T07:00:00Z", "מאוחר");

    const out = await runVoiceTool("get_next_appointment", {}, s.ctx);
    expect(out.spoken).toContain("דניאל");
    expect(out.spoken).toContain("14:00");
    expect(out.actionTaken).toBe("get_next_appointment");
  });

  it("stays inside the tenant", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-03T10:00:00Z", "של מישהו אחר");

    const out = await runVoiceTool("get_next_appointment", {}, mine.ctx);
    expect(out.spoken).toBe("אין לך תורים נוספים להיום.");
  });
});

describe("get_today_summary", () => {
  it("counts the shop's day and names what is left", async () => {
    const s = await shop();
    await book(s, "2026-09-03T05:00:00Z", "בוקר");
    await book(s, "2026-09-03T11:00:00Z", "צהריים");

    const out = await runVoiceTool("get_today_summary", {}, s.ctx);
    expect(out.spoken).toContain("2 תורים");
    expect(out.spoken).toContain("14:00");
  });

  it("uses the shop's midnight, not the server's", async () => {
    // 21:30Z is already tomorrow in Jerusalem; counting it as today would tell
    // an owner at breakfast about an appointment they have slept through.
    const s = await shop();
    await book(s, "2026-09-03T21:30:00Z", "אחרי חצות");

    const out = await runVoiceTool("get_today_summary", {}, s.ctx);
    expect(out.spoken).toBe("אין לך תורים היום.");
  });
});

describe("find_client_appointments", () => {
  it("matches part of a name", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דניאל לוי");

    const out = await runVoiceTool(
      "find_client_appointments",
      { name: "דניאל" },
      s.ctx,
    );
    expect(out.spoken).toContain("דניאל לוי");
  });

  it("refuses a wildcard rather than reading out the diary", async () => {
    // A mis-heard name can be anything. `%` unescaped matches every client.
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דניאל לוי");

    const out = await runVoiceTool(
      "find_client_appointments",
      { name: "%%" },
      s.ctx,
    );
    expect(out.spoken).toContain("לא מצאתי");
  });

  it("asks again when it heard nothing usable", async () => {
    const s = await shop();
    const out = await runVoiceTool("find_client_appointments", { name: "" }, s.ctx);
    expect(out.spoken).toContain("לא שמעתי");
    expect(out.actionTaken).toBe("none");
  });
});

describe("propose_cancel_appointment", () => {
  it("proposes, and changes nothing", async () => {
    /**
     * The assertion this whole file exists for. The tool returns a proposal
     * naming the client and the time; the appointment is still live afterwards,
     * and only the owner's tap on the card can end it.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("propose_cancel_appointment");
    expect(out.proposal?.kind).toBe("cancel");
    expect(out.proposal?.clientName).toBe("דנה כהן");
    expect(out.proposal?.when).toBe("10:00");
    expect(out.spoken).toContain("לאשר");

    // Still there, still bookable — nothing was written.
    const after = await runVoiceTool("get_next_appointment", {}, s.ctx);
    expect(after.spoken).toContain("דנה כהן");
  });

  it("refuses when the name is ambiguous", async () => {
    /**
     * Two upcoming appointments for one name is exactly when a confident
     * cancellation is most expensive, and exactly when a transcript is least
     * able to say which was meant.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(s, "2026-09-05T07:00:00Z", "דנה לוי");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );

    expect(out.proposal).toBeUndefined();
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("2 תורים");
  });

  it("says so when there is nothing to cancel", async () => {
    const s = await shop();
    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "מישהו" },
      s.ctx,
    );
    expect(out.proposal).toBeUndefined();
    expect(out.spoken).toContain("לא מצאתי");
  });
});

describe("an unknown tool", () => {
  it("costs a sentence, not a crash", async () => {
    // The model chooses these names. A hallucinated one must not 500 in the
    // middle of a turn the owner is standing there waiting for.
    const s = await shop();
    const out = await runVoiceTool("drop_everything", {}, s.ctx);
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("לא הבנתי");
  });
});
