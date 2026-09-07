import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { BLOCKING_STATUSES } from "@/db/queries/appointments";
import { appointments } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

import {
  executePending,
  PLACEHOLDER_NAME,
  READ_ONLY_TOOLS,
  runVoiceTool,
  upcomingRoster,
  ROSTER_LIMIT,
  VOICE_TOOLS,
  type ToolContext,
} from "./libi-tools";

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
  it("offers no tool that destroys without asking", () => {
    /**
     * Stated as a test rather than as a comment, because the next tool somebody
     * adds is the one that will not be reviewed with this in mind.
     *
     * **The line moved once, and it moved deliberately.** This used to forbid
     * *any* writing tool. `create_appointment` writes, and is allowed to: it
     * takes an empty slot, tells nobody, and is undone with one tap on the
     * calendar the owner is already holding. What is still forbidden is a tool
     * that can cancel or move an existing booking on one mis-heard sentence —
     * an arrangement a client is relying on, undone without them, by a channel
     * that cannot tell `בטל` from `בדוק`.
     */
    for (const tool of VOICE_TOOLS) {
      const name = tool.function.name;
      if (/cancel|delete|remove|update|reschedule|move/.test(name)) {
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
     * The assertion this whole file exists for. The tool returns a pending
     * action naming the client and the time; the appointment is still live
     * afterwards, and only an answer to the question she just asked ends it.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("propose_cancel_appointment");
    expect(out.pending?.kind).toBe("cancel");
    expect(out.pending?.clientName).toBe("דנה כהן");
    expect(out.pending?.when).toBe("10:00");
    expect(out.spoken).toContain("לבטל אותו?");

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

    expect(out.pending).toBeUndefined();
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
    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("לא מצאתי");
  });
});

describe("create_appointment", () => {
  it("books without a phone number, and marks the row as a placeholder", async () => {
    /**
     * **The point of the feature.** Nobody dictates a phone number to a phone
     * they are holding in a busy shop, so the tool has to produce a row anyway
     * — one that holds the slot against an online client, and that says why it
     * has no number rather than looking like a broken write.
     */
    const s = await shop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("create_appointment");
    expect(out.spoken).toContain("תור קולי");
    // The tip the brief asks for, said once and only for a placeholder.
    expect(out.spoken).toContain("להוסיף את הטלפון");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));

    expect(row.clientName).toBe("דני");
    expect(row.clientPhone).toBe("");
    expect(row.isVoicePlaceholder).toBe(true);
    // Non-terminal, which is what actually blocks the slot.
    expect(BLOCKING_STATUSES).toContain(row.status);
  });

  it("is an ordinary booking when a number was dictated", async () => {
    // The flag is about the *absence* of a number, not about who booked it. A
    // voice booking with a phone can be reminded like any other, so marking it
    // would hide it from the clients list for no reason.
    const s = await shop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "רותי", time: "16:00", phone: "052-123-4567" },
      s.ctx,
    );

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));

    expect(row.isVoicePlaceholder).toBe(false);
    expect(row.clientPhone).not.toBe("");
    expect(out.spoken).not.toContain("תור קולי");
  });

  it("falls back to a name when none was heard", async () => {
    // "תקבעי משהו לשלוש" is a real sentence. The slot still has to be held, and
    // an empty name on a calendar is worse than a labelled one.
    const s = await shop();
    await runVoiceTool("create_appointment", { time: "17:00" }, s.ctx);

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));

    expect(row.clientName).toBe(PLACEHOLDER_NAME);
  });

  it("defaults to today in the shop's zone, not the server's", async () => {
    /**
     * `NOW` is 09:00Z, which is 12:00 in Jerusalem on the 3rd. A booking for
     * "15:00" with no date must land on the 3rd at 12:00Z — a server resolving
     * the day in its own zone is how a booking ends up a day out.
     */
    const s = await shop();
    await runVoiceTool("create_appointment", { time: "15:00" }, s.ctx);

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));

    expect(row.startsAt.toISOString()).toBe("2026-09-03T12:00:00.000Z");
  });

  it("refuses the slot rather than double-booking it", async () => {
    // The exclusion constraint is the guarantee; this asserts it arrives as a
    // sentence instead of an unhandled error in the middle of a turn.
    const s = await shop();
    await book(s, "2026-09-04T12:00:00Z", "כבר תפוס");

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("כבר תור");
  });

  it("asks again rather than guessing at a time it did not hear", async () => {
    const s = await shop();
    for (const args of [{}, { time: "מחר" }, { time: "99:00" }]) {
      const out = await runVoiceTool("create_appointment", args, s.ctx);
      expect(out.actionTaken, JSON.stringify(args)).toBe("none");
    }

    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(rows).toHaveLength(0);
  });
});

describe("propose_reschedule_appointment", () => {
  it("describes the move and changes nothing", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "17:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("propose_reschedule_appointment");
    expect(out.pending?.kind).toBe("reschedule");
    expect(out.spoken).toContain("דנה כהן");
    expect(out.spoken).toContain("10:00");
    expect(out.spoken).toContain("17:00");

    // Still where it was.
    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(row.startsAt.toISOString()).toBe("2026-09-04T07:00:00.000Z");
  });

  it("keeps the appointment's own day when only a time was said", async () => {
    /**
     * "תזיזי את דנה לחמש" about tomorrow's booking means tomorrow at five.
     * Defaulting to today would propose a move into this morning, which the
     * next guard would then reject as being in the past — so the owner would
     * see a refusal for a sentence that was perfectly clear.
     */
    const s = await shop();
    await book(s, "2026-09-05T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", time: "17:00" },
      s.ctx,
    );

    expect(out.pending?.kind).toBe("reschedule");
    if (out.pending?.kind === "reschedule") {
      expect(out.pending.targetDate).toBe("2026-09-05");
    }
  });

  it("refuses a move into the past", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-01", time: "10:00" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("עבר");
  });

  it("reads the times back when the name is ambiguous", async () => {
    // Two דניאלs is the collision the confirmation step exists for, and the
    // useful answer names the times rather than counting them.
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דניאל כהן");
    await book(s, "2026-09-04T11:00:00Z", "דניאל לוי");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דניאל", time: "17:00" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("10:00");
    expect(out.spoken).toContain("14:00");
  });
});

describe("collisions and after-hours", () => {
  it("names who is in the way rather than just refusing", async () => {
    /**
     * The constraint can only say no. An owner who is told "that did not work"
     * has to go and look; one who is told "עומר is in it" already knows what to
     * do — and the range is what is checked, not the start, so a long service
     * that *runs into* the next booking is caught too.
     */
    const s = await shop();
    await book(s, "2026-09-04T12:00:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("עומר לוי");
    expect(out.spoken).toContain("תרצה לבחור שעה אחרת");

    // And nothing was written on the way to saying so.
    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(rows).toHaveLength(1);
  });

  it("catches a booking that starts free and runs into the next one", async () => {
    // 14:30 is empty; a 30-minute service from there ends at 15:00, which is
    // where עומר starts. Checking only the start time would have allowed it and
    // left the constraint to reject the insert with no name to offer.
    const s = await shop();
    await book(s, "2026-09-04T11:45:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "14:30" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("עומר לוי");
  });

  it("allows a booking outside posted hours", async () => {
    /**
     * **The owner has authority the availability engine does not.** Squeezing
     * somebody in at seven in the morning or ten at night is most of what a
     * shop's day actually is, and this path deliberately never consults posted
     * hours — matching `createManualBookingAction`, which skips them for the
     * same reason.
     */
    const s = await shop();

    for (const time of ["06:30", "23:30"]) {
      const out = await runVoiceTool(
        "create_appointment",
        { name: `לקוח ${time}`, date: "2026-09-04", time },
        s.ctx,
      );
      expect(out.actionTaken, time).toBe("create_appointment");
    }

    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(rows).toHaveLength(2);
  });

  it("finds the clash when she asks, not after the owner has agreed", async () => {
    /**
     * **A confirmation spent on a move that was never possible is the failure
     * here.** Checking only on execution would mean asking "להזיז אותו לחמש?",
     * hearing "כן", and only then admitting the slot is taken.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(s, "2026-09-04T14:00:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "17:00" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("עומר לוי");
  });

  it("does not treat an appointment as blocking itself", async () => {
    /**
     * A fifteen-minute nudge overlaps the row's own former range. An exclusion
     * constraint never compares a row against itself, so a check that did would
     * refuse moves the database is perfectly happy with — and small nudges are
     * most of what rescheduling is.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "10:15" },
      s.ctx,
    );

    expect(out.pending?.kind).toBe("reschedule");

    const done = await executePending(out.pending!, s.ctx);
    expect(done.actionTaken).toBe("confirmed");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(row.startsAt.toISOString()).toBe("2026-09-04T07:15:00.000Z");
  });

  it("moves outside posted hours when asked to", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "22:00" },
      s.ctx,
    );

    expect(out.pending?.kind).toBe("reschedule");
    expect((await executePending(out.pending!, s.ctx)).actionTaken).toBe(
      "confirmed",
    );
  });
});

describe("executePending", () => {
  it("cancels only after the answer, and only what it described", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const proposed = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );
    expect(proposed.pending).toBeDefined();

    const done = await executePending(proposed.pending!, s.ctx);
    expect(done.actionTaken).toBe("confirmed");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(row.status).toBe("cancelled");
  });

  it("moves the appointment, carrying its duration with it", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const proposed = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "17:00" },
      s.ctx,
    );

    const done = await executePending(proposed.pending!, s.ctx);
    expect(done.actionTaken).toBe("confirmed");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));

    expect(row.startsAt.toISOString()).toBe("2026-09-04T14:00:00.000Z");
    // 30 minutes, the same length it had before the move.
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(30 * 60_000);
  });

  it("refuses when the appointment moved between the question and the answer", async () => {
    /**
     * **The collision this whole step exists to prevent.** The owner has
     * another tab, the client has a cancel link, and a few seconds pass while
     * ליבי asks. Applying the confirmed change to whatever is there *now* would
     * be answering a question nobody asked.
     */
    const s = await shop();
    const booked = await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const proposed = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );

    // Somebody moves it while she is waiting for an answer.
    await db
      .update(appointments)
      .set({
        startsAt: new Date("2026-09-04T09:00:00Z"),
        endsAt: new Date("2026-09-04T09:30:00Z"),
      })
      .where(eq(appointments.id, booked.id));

    const out = await executePending(proposed.pending!, s.ctx);
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("השתנה");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, booked.id));
    expect(row.status).not.toBe("cancelled");
  });

  it("cannot reach another tenant's appointment", async () => {
    /**
     * The pending action arrives from the browser and can say anything. The id
     * is resolved under *this* request's business, so one belonging to another
     * shop resolves to nothing at all rather than to somebody else's client.
     */
    const mine = await shop();
    const theirs = await shop();
    const booked = await book(
      theirs,
      "2026-09-04T07:00:00Z",
      "לקוח של מישהו אחר",
    );

    const out = await executePending(
      {
        kind: "cancel",
        appointmentId: booked.id,
        clientName: "לקוח של מישהו אחר",
        when: "10:00",
        startsAtIso: "2026-09-04T07:00:00.000Z",
      },
      mine.ctx,
    );

    expect(out.actionTaken).toBe("none");

    const [row] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, booked.id));
    expect(row.status).not.toBe("cancelled");
  });

  it("leaves the appointment alone when the slot is taken while she asks", async () => {
    /**
     * **The race the propose-time check cannot close.** A clash that exists
     * when she asks is caught there and no confirmation is ever spent on it —
     * that is the test above. This is the other one: the slot was free when she
     * asked, and somebody took it in the seconds before the owner said yes.
     */
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const proposed = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-04", time: "17:00" },
      s.ctx,
    );
    expect(proposed.pending?.kind).toBe("reschedule");

    // 17:00 local is 14:00Z. Booked after the question, before the answer.
    await book(s, "2026-09-04T14:00:00Z", "מישהו אחר");

    const out = await executePending(proposed.pending!, s.ctx);
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("מישהו אחר");

    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    const dana = rows.find((r) => r.clientName === "דנה כהן")!;
    expect(dana.startsAt.toISOString()).toBe("2026-09-04T07:00:00.000Z");
  });
});

describe("the frozen-tenant tool set", () => {
  it("offers reads only, and is derived rather than duplicated", () => {
    // A tool added to VOICE_TOOLS is write-by-default: it has to be named in
    // the write list to be withheld, so forgetting fails closed.
    const names = READ_ONLY_TOOLS.map((t) => t.function.name);

    expect(names).toContain("get_today_summary");
    expect(names).not.toContain("create_appointment");
    expect(names).not.toContain("propose_cancel_appointment");
    expect(names).not.toContain("propose_reschedule_appointment");
    expect(READ_ONLY_TOOLS.length).toBeLessThan(VOICE_TOOLS.length);
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

describe("upcomingRoster", () => {
  it("starts at the shop's midnight, not at now", async () => {
    /**
     * An owner asking at four in the afternoon what their day looked like has
     * to see the morning. Anchoring on `now` would answer "nothing so far
     * today" to somebody who has cut hair since eight.
     */
    const s = await shop();
    await book(s, "2026-09-03T05:00:00Z", "בוקר");
    await book(s, "2026-09-03T13:00:00Z", "אחר הצהריים");

    const roster = await upcomingRoster(s.ctx);
    expect(roster.map((r) => r.clientName)).toEqual(["בוקר", "אחר הצהריים"]);
  });

  it("never carries a phone number", async () => {
    // Every row here is sent to OpenAI on every turn. A client's number is not
    // needed to say when they are coming, and the cheapest way to keep it out
    // of a third party's logs is not to select it.
    const s = await shop();
    await book(s, "2026-09-03T11:00:00Z", "דנה");

    const [row] = await upcomingRoster(s.ctx);
    expect(Object.keys(row).sort()).toEqual([
      "clientName",
      "serviceName",
      "startsAt",
      "status",
    ]);
  });

  it("omits cancelled and no-show bookings", async () => {
    /**
     * The most expensive thing this assistant could get wrong. A cancelled slot
     * read back as booked sends an owner to meet somebody who is not coming —
     * and once it is in the prompt, no tool is standing between that row and
     * the sentence.
     */
    const s = await shop();
    await book(s, "2026-09-03T10:00:00Z", "ביטל", { status: "cancelled" });
    await book(s, "2026-09-03T10:30:00Z", "לא הגיע", { status: "no_show" });
    await book(s, "2026-09-03T12:00:00Z", "מגיע");

    const roster = await upcomingRoster(s.ctx);
    expect(roster.map((r) => r.clientName)).toEqual(["מגיע"]);
  });

  it("stays inside the tenant", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-03T10:00:00Z", "של מישהו אחר");

    expect(await upcomingRoster(mine.ctx)).toEqual([]);
  });

  it("stops at the window and at the cap", async () => {
    // Bounded on both axes: every row costs tokens and latency on a turn the
    // owner is waiting through.
    const s = await shop();
    await book(s, "2026-09-20T08:00:00Z", "מחוץ לחלון");
    for (let i = 0; i < ROSTER_LIMIT + 5; i++) {
      const hour = String(6 + (i % 12)).padStart(2, "0");
      const day = String(3 + Math.floor(i / 12)).padStart(2, "0");
      await book(s, `2026-09-${day}T${hour}:0${i % 6}:00Z`, `לקוח ${i}`);
    }

    const roster = await upcomingRoster(s.ctx);
    expect(roster.length).toBeLessThanOrEqual(ROSTER_LIMIT);
    expect(roster.some((r) => r.clientName === "מחוץ לחלון")).toBe(false);
  });
});
