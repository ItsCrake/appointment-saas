import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { BLOCKING_STATUSES } from "@/db/queries/appointments";
import { appointments, businesses, staff } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  createAppointment,
  createBusiness,
  createService,
  createStaff,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

import {
  answerDraft,
  CLIENT_NAME_DAYS,
  executePending,
  PLACEHOLDER_NAME,
  READ_ONLY_TOOLS,
  routeByVerb,
  runVoiceTool,
  upcomingClientNames,
  upcomingRoster,
  ROSTER_LIMIT,
  VOICE_TOOLS,
  type DraftAction,
  type PendingAction,
  type ToolContext,
} from "./libi-tools";
import { rosterDays } from "./libi-context";

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
    hasMultipleStaff: false,
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
      if (/cancel|delete|remove|update|reschedule|move|swap/.test(name)) {
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
    expect(out.pending).toMatchObject({
      kind: "cancel",
      clientName: "דנה כהן",
      when: "10:00",
    });
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

describe("show_appointment_in_calendar", () => {
  it("points at the booking at the time asked for", async () => {
    const shop_ = await shop();
    await book(shop_, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(shop_, "2026-09-04T13:00:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04", time: "16:00" },
      shop_.ctx,
    );

    expect(out.actionTaken).toBe("show_appointment_in_calendar");
    expect(out.spoken).toContain("עומר לוי");
    expect(out.navigate?.href).toContain("week=2026-09-04");
    expect(out.navigate?.href).toContain("focus=");
  });

  it("takes the nearest booking rather than an exact match", async () => {
    /**
     * **A diary is full of times nothing starts precisely at.** A 16:00 that is
     * really a 15:45 running long, or a mis-heard quarter hour, would make an
     * exact match a correct answer to a question nobody asked.
     */
    const shop_ = await shop();
    await book(shop_, "2026-09-04T12:45:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04", time: "16:00" },
      shop_.ctx,
    );

    expect(out.spoken).toContain("עומר לוי");
    expect(out.navigate).toBeDefined();
  });

  it("takes the day's first when no time was said, and says how many more", async () => {
    // The brief's own answer to the ambiguous case, and a better one than
    // asking: the owner is looking at the day a second later anyway.
    const shop_ = await shop();
    await book(shop_, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(shop_, "2026-09-04T13:00:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04" },
      shop_.ctx,
    );

    expect(out.spoken).toContain("דנה כהן");
    expect(out.spoken).toContain("10:00");
    expect(out.spoken).toContain("עוד 1");
  });

  it("narrows by name when one was said", async () => {
    const shop_ = await shop();
    await book(shop_, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(shop_, "2026-09-04T13:00:00Z", "עומר לוי");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04", name: "עומר" },
      shop_.ctx,
    );

    expect(out.spoken).toContain("עומר לוי");
    expect(out.spoken).not.toContain("דנה");
  });

  it("says so rather than navigating to an empty day", async () => {
    const shop_ = await shop();
    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04" },
      shop_.ctx,
    );

    expect(out.navigate).toBeUndefined();
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("לא מצאתי");
  });

  it("builds the path itself and stays inside the app", async () => {
    /**
     * The href is assembled from the row's own date and id, never from
     * anything the model wrote — so a hallucinated argument cannot become a
     * link the dashboard follows.
     */
    const shop_ = await shop();
    await book(shop_, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04", name: "דנה" },
      shop_.ctx,
    );

    expect(out.navigate?.href.startsWith("/dashboard/agenda/full?")).toBe(true);
  });

  it("stays inside the tenant", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-04T07:00:00Z", "לקוח של מישהו אחר");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04" },
      mine.ctx,
    );

    expect(out.navigate).toBeUndefined();
  });
});
describe("the frozen-tenant tool set", () => {
  it("offers reads only, and is derived rather than duplicated", () => {
    // A tool added to VOICE_TOOLS is write-by-default: it has to be named in
    // the write list to be withheld, so forgetting fails closed.
    const names = READ_ONLY_TOOLS.map((t) => t.function.name);

    expect(names).toContain("get_today_summary");
    // Showing is a read. A frozen tenant may look at their own week — the
    // calendar page itself uses `requireBusiness`, not `requireWritable`.
    expect(names).toContain("show_appointment_in_calendar");
    expect(names).not.toContain("create_appointment");
    expect(names).not.toContain("propose_cancel_appointment");
    expect(names).not.toContain("propose_reschedule_appointment");
    expect(names).not.toContain("propose_swap_appointments");
    // Reading the week is a read, like reading the day.
    expect(names).toContain("get_week_summary");
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
    for (let i = 0; i < 15; i++) {
      const hour = String(6 + (i % 12)).padStart(2, "0");
      const day = String(3 + Math.floor(i / 12)).padStart(2, "0");
      await book(s, `2026-09-${day}T${hour}:0${i % 6}:00Z`, `לקוח ${i}`);
    }

    const capped = await upcomingRoster(s.ctx, rosterDays("2026-09-03"), 10);
    expect(capped).toHaveLength(10);
    expect(capped.some((r) => r.clientName === "מחוץ לחלון")).toBe(false);

    // The default cap holds a busy week whole.
    const week = await upcomingRoster(s.ctx);
    expect(week).toHaveLength(15);
    expect(ROSTER_LIMIT).toBeGreaterThanOrEqual(200);
  });
});

describe("upcomingClientNames", () => {
  it("lists each client once, nearest booking first", async () => {
    /**
     * The transcriber's keywords. Nearest first, so a cap trims next
     * fortnight's clients rather than this afternoon's — and once each,
     * because a regular with three bookings is still one name to hear.
     */
    const s = await shop();
    await book(s, "2026-09-10T08:00:00Z", "ברהנו אדמסו");
    await book(s, "2026-09-03T13:00:00Z", "ג'ורג' ג'בארין");
    await book(s, "2026-09-04T08:00:00Z", "ארטיום לבדב");
    await book(s, "2026-09-05T08:00:00Z", "ג'ורג' ג'בארין");

    expect(await upcomingClientNames(s.ctx, 10)).toEqual([
      "ג'ורג' ג'בארין",
      "ארטיום לבדב",
      "ברהנו אדמסו",
    ]);
  });

  it("includes this morning, and stops at the fortnight", async () => {
    // "מה עם דני מהבוקר?" is a question about somebody already seen today.
    const s = await shop();
    await book(s, "2026-09-03T05:00:00Z", "מהבוקר");
    await book(s, "2026-09-02T10:00:00Z", "אתמול");
    const beyond = String(3 + CLIENT_NAME_DAYS).padStart(2, "0");
    await book(s, `2026-09-${beyond}T08:00:00Z`, "רחוק מדי");

    const names = await upcomingClientNames(s.ctx, 10);
    expect(names).toContain("מהבוקר");
    expect(names).not.toContain("אתמול");
    expect(names).not.toContain("רחוק מדי");
  });

  it("leaves out cancellations and the voice placeholder", async () => {
    // A cancelled client is not about to be named; "תור קולי" is a label on a
    // slot, not a person, and as a keyword it would only bias toward itself.
    const s = await shop();
    await book(s, "2026-09-03T10:00:00Z", "ביטל", { status: "cancelled" });
    await book(s, "2026-09-03T11:00:00Z", PLACEHOLDER_NAME);
    await book(s, "2026-09-03T12:00:00Z", "מגיע");

    expect(await upcomingClientNames(s.ctx, 10)).toEqual(["מגיע"]);
  });

  it("stops at the limit it is given", async () => {
    const s = await shop();
    for (let i = 0; i < 6; i++) {
      const hour = String(6 + i).padStart(2, "0");
      await book(s, `2026-09-0${4 + (i % 5)}T${hour}:00:00Z`, `לקוח ${i}`);
    }
    expect(await upcomingClientNames(s.ctx, 3)).toHaveLength(3);
  });

  it("stays inside the tenant", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-03T10:00:00Z", "של מישהו אחר");

    expect(await upcomingClientNames(mine.ctx, 10)).toEqual([]);
  });
});

describe("a name the transcriber spelled its own way", () => {
  /**
   * The substring lookup is tried first and a near match second — see
   * `upcomingFor`. What matters is that the diary's own name is what comes
   * back, so a near match is always heard, and the destructive tools still
   * wait for an answer.
   */
  it("finds a client whose vowel letters were dropped", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "ג'ורג' ג'בארין");

    const out = await runVoiceTool(
      "find_client_appointments",
      { name: "ג'ורג' ג'ברין" },
      s.ctx,
    );
    expect(out.actionTaken).toBe("find_client_appointments");
    expect(out.spoken).toContain("ג'ורג' ג'בארין");
  });

  it("proposes the cancellation under the diary's spelling, and writes nothing", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "ג'ורג' ג'בארין");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "גורג גבארין" },
      s.ctx,
    );
    expect(out.pending).toMatchObject({
      kind: "cancel",
      clientName: "ג'ורג' ג'בארין",
    });
    expect(out.spoken).toContain("ג'ורג' ג'בארין");

    const after = await runVoiceTool("get_next_appointment", {}, s.ctx);
    expect(after.spoken).toContain("ג'ורג' ג'בארין");
  });

  it("proposes a move for a surname heard with an extra letter", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "ארטיום לבדב");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "ארטיום לוודאב", time: "15:30" },
      s.ctx,
    );
    expect(out.pending).toMatchObject({
      kind: "reschedule",
      clientName: "ארטיום לבדב",
    });
  });

  it("asks which, by name, when a near match fits two people", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "איתן אלקיים");
    await book(s, "2026-09-05T08:00:00Z", "איתן טולדנו");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "איתי" },
      s.ctx,
    );
    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("איתן אלקיים");
    expect(out.spoken).toContain("איתן טולדנו");
  });

  it("does not read one short name as another", async () => {
    // דנה is not דינה. A short name is a whole name, and the lookup says so.
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דינה לוי");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );
    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("לא מצאתי");
  });

  it("shows the right booking for a near name", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(s, "2026-09-04T13:00:00Z", "אליאס ג'בארין");

    const out = await runVoiceTool(
      "show_appointment_in_calendar",
      { date: "2026-09-04", name: "אליס ג'בארין" },
      s.ctx,
    );
    expect(out.actionTaken).toBe("show_appointment_in_calendar");
    expect(out.spoken).toContain("אליאס ג'בארין");
  });

  it("books the service the owner named, however it was worded", async () => {
    const s = await shop();
    await createService(db, s.business.id, {
      name: "עיצוב זקן",
      durationMin: 20,
    });

    await runVoiceTool(
      "create_appointment",
      {
        name: "דני",
        date: "2026-09-04",
        time: "15:00",
        service: "עיצוב זקנים",
      },
      s.ctx,
    );

    await runVoiceTool(
      "create_appointment",
      { name: "רון", date: "2026-09-04", time: "17:00", service: "עיצוב הזקן" },
      s.ctx,
    );

    const rows = await db
      .select({
        client: appointments.clientName,
        service: appointments.serviceName,
      })
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(rows).toContainEqual({ client: "דני", service: "עיצוב זקן" });
    expect(rows).toContainEqual({ client: "רון", service: "עיצוב זקן" });
  });

  it("asks which of two services it could be, rather than guessing", async () => {
    /**
     * "תספורות" is equally near to both haircuts. This used to fall back to
     * the shop's first service — צבע, here — which is a booking at a length
     * nobody chose. It is now a question naming the two it could be.
     */
    const s = await shop();
    await createService(db, s.business.id, {
      name: "תספורת ילד",
      durationMin: 20,
    });
    await createService(db, s.business.id, {
      name: "צבע",
      durationMin: 20,
      sortOrder: -1,
    });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00", service: "תספורות" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("תספורת גבר");
    expect(out.spoken).toContain("תספורת ילד");
    expect(out.spoken).not.toContain("צבע");
    expect(out.draft).toMatchObject({ kind: "book", awaiting: "service" });

    const rows = await db
      .select()
      .from(appointments)
      .where(eq(appointments.businessId, s.business.id));
    expect(rows).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Slot-filling: a missing detail is a question, never a default.             */
/* -------------------------------------------------------------------------- */

/** Every row this shop holds — the check that a question wrote nothing. */
async function rowsOf(businessId: string) {
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.businessId, businessId));
}

/**
 * A two-chair shop: the factory's provider renamed שירן, and מאיה beside her.
 * The flag is set on the row as the route would read it, and on the context
 * the tools actually take.
 */
async function teamShop() {
  const s = await shop();
  await db
    .update(businesses)
    .set({ hasMultipleStaff: true })
    .where(eq(businesses.id, s.business.id));
  const [shiran] = await db
    .update(staff)
    .set({ name: "שירן" })
    .where(eq(staff.businessId, s.business.id))
    .returning();
  const maya = await createStaff(db, s.business.id, {
    name: "מאיה",
    sortOrder: 1,
  });
  return { ...s, shiran, maya, ctx: { ...s.ctx, hasMultipleStaff: true } };
}

describe("create_appointment asks for what it was not told", () => {
  it("asks for the hour rather than guessing it, and holds the rest", async () => {
    const s = await shop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04" },
      s.ctx,
    );

    expect(out.spoken).toBe("לאיזו שעה לקבוע את התור לדני?");
    expect(out.actionTaken).toBe("none");
    expect(out.draft).toEqual({
      kind: "book",
      awaiting: "time",
      name: "דני",
      date: "2026-09-04",
    });
    expect(await rowsOf(s.business.id)).toHaveLength(0);
  });

  it("asks which service when the shop sells several and none was said", async () => {
    /**
     * The service sets how long the slot is held. Defaulting to the shop's
     * first one was a booking at a length nobody chose — the requirement this
     * replaced it with is that she asks, naming what the shop sells.
     */
    const s = await shop();
    await createService(db, s.business.id, { name: "זקן", durationMin: 15 });
    await createService(db, s.business.id, { name: "צבע", durationMin: 60 });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.spoken).toBe("איזה שירות לדני — זקן, צבע או תספורת גבר?");
    expect(out.draft).toEqual({
      kind: "book",
      awaiting: "service",
      name: "דני",
      date: "2026-09-04",
      time: "15:00",
    });
    expect(await rowsOf(s.business.id)).toHaveLength(0);
  });

  it("offers a long price list as examples rather than reading all of it", async () => {
    const s = await shop();
    for (const name of ["א1", "א2", "א3", "א4", "א5"]) {
      await createService(db, s.business.id, { name });
    }

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", time: "15:00" },
      s.ctx,
    );

    expect(out.spoken).toContain("למשל");
    expect(out.spoken).not.toContain("תספורת גבר");
  });

  it("says it did not find a service nothing matches, then lists the shop's", async () => {
    const s = await shop();
    await createService(db, s.business.id, { name: "זקן", durationMin: 15 });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", time: "15:00", service: "מניקור" },
      s.ctx,
    );

    expect(out.spoken).toBe(
      "לא מצאתי שירות בשם מניקור. איזה שירות לדני — זקן או תספורת גבר?",
    );
    expect(out.draft).toMatchObject({ awaiting: "service" });
  });

  it("books the only service there is without asking, and does not name it", async () => {
    const s = await shop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("create_appointment");
    expect(out.draft).toBeUndefined();
    expect(out.spoken).not.toContain("תספורת גבר");
  });

  it("says which service it booked when there was a choice", async () => {
    const s = await shop();
    await createService(db, s.business.id, { name: "זקן", durationMin: 15 });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00", service: "זקן" },
      s.ctx,
    );

    expect(out.spoken).toContain("מחר ב-15:00, זקן.");
    const [row] = await rowsOf(s.business.id);
    expect(row.serviceName).toBe("זקן");
    expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(15 * 60_000);
  });
});

describe("create_appointment in a shop with more than one chair", () => {
  it("asks who, among the people free for the whole service", async () => {
    const s = await teamShop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.spoken).toBe("אצל מי לדנה — שירן או מאיה?");
    expect(out.draft).toEqual({
      kind: "book",
      awaiting: "staff",
      name: "דנה",
      date: "2026-09-04",
      time: "15:00",
      serviceId: s.service.id,
      service: "תספורת גבר",
    });
    expect(await rowsOf(s.business.id)).toHaveLength(0);
  });

  it("books the one person who is free, and says who", async () => {
    // מאיה's 14:45–15:15 overlaps a 15:00 haircut; שירן is free.
    const s = await teamShop();
    await book(s, "2026-09-04T11:45:00Z", "תפוסה", { staffId: s.maya.id });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("create_appointment");
    expect(out.spoken).toContain("אצל שירן");
    const mine = (await rowsOf(s.business.id)).find(
      (row) => row.clientName === "דנה",
    );
    expect(mine?.staffId).toBe(s.shiran.id);
  });

  it("says so when nobody is free, and writes nothing", async () => {
    const s = await teamShop();
    await book(s, "2026-09-04T12:00:00Z", "אצל שירן", { staffId: s.shiran.id });
    await book(s, "2026-09-04T12:00:00Z", "אצל מאיה", { staffId: s.maya.id });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.spoken).toContain("כל נותני השירות תפוסים");
    expect(out.draft).toBeUndefined();
    expect(await rowsOf(s.business.id)).toHaveLength(2);
  });

  it("refuses a named provider who is busy, and names the booking in the way", async () => {
    const s = await teamShop();
    await book(s, "2026-09-04T12:00:00Z", "עומר", { staffId: s.maya.id });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00", staff: "מאיה" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("למאיה יש כבר תור");
    expect(out.spoken).toContain("עומר");
  });

  it("asks again when the named provider is nobody in this shop", async () => {
    const s = await teamShop();

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00", staff: "רונית" },
      s.ctx,
    );

    expect(out.spoken).toBe(
      "לא מצאתי נותן שירות בשם רונית. אצל מי — שירן או מאיה?",
    );
    expect(out.draft).toMatchObject({ awaiting: "staff" });
  });

  it("books whoever was named, prefix and all", async () => {
    const s = await teamShop();

    await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00", staff: "למאיה" },
      s.ctx,
    );

    const [row] = await rowsOf(s.business.id);
    expect(row.staffId).toBe(s.maya.id);
  });

  it("never asks who in a single-chair shop, whoever else is on the roster", async () => {
    // `has_multiple_staff` off means the primary takes every booking — the
    // booking page's own rule, which a spoken booking must not quietly break.
    const s = await shop();
    const extra = await createStaff(db, s.business.id, { name: "מחליף" });

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("create_appointment");
    expect(out.spoken).not.toContain("אצל");
    const [row] = await rowsOf(s.business.id);
    expect(row.staffId).not.toBe(extra.id);
  });
});

describe("answerDraft: the answer to her question", () => {
  it("completes a booking from one word, on the day it was asked about", async () => {
    /**
     * "זקן" alone means nothing; after "איזה שירות לדני?" it is the rest of a
     * booking for tomorrow at three. The draft holds tomorrow — nothing has to
     * work the date out again.
     */
    const s = await shop();
    await createService(db, s.business.id, { name: "זקן", durationMin: 15 });

    const asked = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );
    const done = await answerDraft(asked.draft!, "זקן.", s.ctx);

    expect(done?.actionTaken).toBe("create_appointment");
    const [row] = await rowsOf(s.business.id);
    expect(row.clientName).toBe("דני");
    expect(row.serviceName).toBe("זקן");
    expect(row.startsAt.toISOString()).toBe("2026-09-04T12:00:00.000Z");
  });

  it("completes a team booking from 'אצל מאיה'", async () => {
    const s = await teamShop();

    const asked = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );
    const done = await answerDraft(asked.draft!, "אצל מאיה", s.ctx);

    expect(done?.spoken).toContain("אצל מאיה");
    const [row] = await rowsOf(s.business.id);
    expect(row.staffId).toBe(s.maya.id);
  });

  it("does not take one provider for another whose name contains it", async () => {
    // "דני" is inside "דנית". A substring test would give דנית's booking to דני.
    const s = await teamShop();
    await db.update(staff).set({ name: "דני" }).where(eq(staff.id, s.shiran.id));
    await db.update(staff).set({ name: "דנית" }).where(eq(staff.id, s.maya.id));

    const asked = await runVoiceTool(
      "create_appointment",
      { name: "רון", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );
    await answerDraft(asked.draft!, "דנית", s.ctx);

    const [row] = await rowsOf(s.business.id);
    expect(row.staffId).toBe(s.maya.id);
  });

  it("leaves to the model what a list cannot read", async () => {
    const s = await shop();
    await createService(db, s.business.id, { name: "זקן", durationMin: 15 });

    const asked = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );
    const draft = asked.draft!;

    expect(await answerDraft(draft, "משהו קצר", s.ctx)).toBeNull();
    // An answer that runs on is a new instruction, not an answer.
    expect(
      await answerDraft(draft, "זקן ואחר כך תגידי לי מה יש לי מחר בבוקר", s.ctx),
    ).toBeNull();

    // The hour is always the model's to read.
    const hour: DraftAction = {
      kind: "book",
      awaiting: "time",
      name: "דני",
      date: "2026-09-04",
    };
    expect(await answerDraft(hour, "בשלוש", s.ctx)).toBeNull();
    expect(await rowsOf(s.business.id)).toHaveLength(0);
  });

  it("lends the chosen service to the same booking finished in other words", async () => {
    // The model completes "אצל מי?" itself, naming the provider but not the
    // service it was never asked about — which the draft already holds.
    const s = await teamShop();
    const beard = await createService(db, s.business.id, {
      name: "זקן",
      durationMin: 15,
    });
    const draft: DraftAction = {
      kind: "book",
      awaiting: "staff",
      name: "דנה",
      date: "2026-09-04",
      time: "15:00",
      serviceId: beard.id,
      service: "זקן",
    };

    const out = await runVoiceTool(
      "create_appointment",
      { name: "דנה", date: "2026-09-04", time: "15:00", staff: "מאיה" },
      s.ctx,
      { draft },
    );

    expect(out.actionTaken).toBe("create_appointment");
    const [row] = await rowsOf(s.business.id);
    expect(row.serviceName).toBe("זקן");
  });

  it("lends nothing to a different booking made instead of answering", async () => {
    const s = await teamShop();
    const beard = await createService(db, s.business.id, { name: "זקן" });
    const draft: DraftAction = {
      kind: "book",
      awaiting: "staff",
      name: "דנה",
      date: "2026-09-04",
      time: "15:00",
      serviceId: beard.id,
    };

    const out = await runVoiceTool(
      "create_appointment",
      { name: "רונית", date: "2026-09-04", time: "17:00", staff: "מאיה" },
      s.ctx,
      { draft },
    );

    // רונית's service was never said, so it is asked — not borrowed.
    expect(out.draft).toMatchObject({ kind: "book", awaiting: "service" });
  });
});

describe("propose_reschedule_appointment with no destination", () => {
  it("asks where to, naming the booking, and holds on to it", async () => {
    const s = await shop();
    const booked = await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה" },
      s.ctx,
    );

    expect(out.spoken).toBe(
      "מצאתי תור של דנה כהן מחר ב-10:00. לאיזו שעה או לאיזה יום להזיז אותו?",
    );
    expect(out.pending).toBeUndefined();
    expect(out.draft).toEqual({
      kind: "move",
      appointmentId: booked.id,
      clientName: "דנה כהן",
      when: "מחר ב-10:00",
      startsAtIso: "2026-09-04T07:00:00.000Z",
    });

    const [row] = await rowsOf(s.business.id);
    expect(row.startsAt.toISOString()).toBe("2026-09-04T07:00:00.000Z");
  });

  it("asks only for the hour when the day was said", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", date: "2026-09-06" },
      s.ctx,
    );

    expect(out.spoken).toContain("לאיזו שעה ביום ראשון להזיז אותו?");
    expect(out.draft).toMatchObject({ kind: "move", date: "2026-09-06" });
  });

  it("moves the booking it asked about, even when the name fits two", async () => {
    const s = await shop();
    const cohen = await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(s, "2026-09-05T07:00:00Z", "דנה לוי");

    const asked = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה כהן" },
      s.ctx,
    );
    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה", time: "17:00" },
      s.ctx,
      { draft: asked.draft },
    );

    expect(out.pending).toMatchObject({
      kind: "reschedule",
      appointmentId: cohen.id,
      targetDate: "2026-09-04",
      targetTime: "17:00",
    });
  });

  it("takes the client from the draft when the answer is only an hour", async () => {
    // "לחמש" has no name in it. The draft is what it answers.
    const s = await shop();
    const booked = await book(s, "2026-09-05T07:00:00Z", "דנה כהן");

    const asked = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "דנה" },
      s.ctx,
    );
    const out = await runVoiceTool(
      "propose_reschedule_appointment",
      { time: "17:00" },
      s.ctx,
      { draft: asked.draft },
    );

    expect(out.pending).toMatchObject({
      kind: "reschedule",
      appointmentId: booked.id,
      // The booking's own day: Saturday, not today.
      targetDate: "2026-09-05",
    });
  });
});

describe("which of a client's bookings", () => {
  it("picks the one the owner named by its time", async () => {
    // The answer to "איזה מהם?" used to resolve to the same two bookings and
    // be asked again, for ever.
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    const later = await book(s, "2026-09-04T11:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה", appointment_time: "14:00" },
      s.ctx,
    );

    expect(out.pending).toMatchObject({
      kind: "cancel",
      appointmentId: later.id,
      when: "14:00",
    });
  });

  it("names the days when the choices fall on different days", async () => {
    // Two bookings at ten on different days used to be read back as
    // "ב-10:00 ו-10:00" — a question nobody could answer.
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    await book(s, "2026-09-06T07:00:00Z", "דנה כהן");

    const out = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("מחר ב-10:00");
    expect(out.spoken).toContain("ביום ראשון ב-10:00");
  });
});

/* -------------------------------------------------------------------------- */
/* Swapping two clients' appointments.                                        */
/* -------------------------------------------------------------------------- */

/** A booking of any length, on any provider. */
async function bookFor(
  s: Awaited<ReturnType<typeof shop>>,
  startsAt: string,
  minutes: number,
  clientName: string,
  overrides: Parameters<typeof createAppointment>[5] = {},
) {
  const from = new Date(startsAt);
  return createAppointment(
    db,
    s.business.id,
    s.service.id,
    from,
    new Date(from.getTime() + minutes * 60_000),
    { clientName, ...overrides },
  );
}

describe("propose_swap_appointments", () => {
  it("proposes an exchange of two equal slots, and writes nothing", async () => {
    const s = await shop();
    const dana = await bookFor(s, "2026-09-04T07:00:00Z", 30, "דנה כהן");
    const ronit = await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי");

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );

    expect(out.actionTaken).toBe("propose_swap_appointments");
    expect(out.spoken).toBe(
      "מחר התור של רונית לוי יעבור ל-10:00, והתור של דנה כהן ל-14:00. להחליף?",
    );
    expect(out.pending).toMatchObject({
      kind: "swap",
      first: {
        appointmentId: dana.id,
        targetStartsAtIso: ronit.startsAt.toISOString(),
      },
      second: {
        appointmentId: ronit.id,
        targetStartsAtIso: dana.startsAt.toISOString(),
      },
    });

    const rows = await rowsOf(s.business.id);
    expect(rows.find((r) => r.id === dana.id)?.startsAt).toEqual(dana.startsAt);
  });

  it("swaps back-to-back bookings of different lengths inside their block", async () => {
    /**
     * A 60-minute colour at 10:00 and a 30-minute cut at 11:00. Exchanging
     * start times would leave a half-hour hole at 10:30 and run the colour to
     * 12:00; swapping their order keeps 10:00–11:30 exactly as full as it was.
     */
    const s = await shop();
    const dana = await bookFor(s, "2026-09-04T07:00:00Z", 60, "דנה כהן");
    await bookFor(s, "2026-09-04T08:00:00Z", 30, "רונית לוי");

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );

    expect(out.spoken).toBe(
      "השירותים באורך שונה, אז מחר התור של רונית לוי יעבור ל-10:00, והתור של דנה כהן ל-10:30. להחליף?",
    );
    expect(out.pending).toMatchObject({
      kind: "swap",
      first: {
        appointmentId: dana.id,
        targetStartsAtIso: "2026-09-04T07:30:00.000Z",
      },
      second: { targetStartsAtIso: "2026-09-04T07:00:00.000Z" },
    });
  });

  it("refuses a swap the longer one does not fit, and says who is in the way", async () => {
    const s = await shop();
    await bookFor(s, "2026-09-04T07:00:00Z", 60, "דנה כהן");
    await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי");
    await bookFor(s, "2026-09-04T11:30:00Z", 30, "עומר");

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.spoken).toBe(
      "אי אפשר להחליף: לתור של דנה כהן צריך שעה, וב-14:30 כבר יש תור לעומר. לא שיניתי כלום.",
    );
  });

  it("refuses when both names lead to the same booking", async () => {
    const s = await shop();
    await bookFor(s, "2026-09-04T07:00:00Z", 30, "דנה כהן");

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "דנה כהן" },
      s.ctx,
    );

    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("לאותו תור");
  });

  it("asks which, when a name fits two bookings — and takes the answer", async () => {
    const s = await shop();
    await bookFor(s, "2026-09-04T07:00:00Z", 30, "דנה כהן");
    await bookFor(s, "2026-09-04T09:00:00Z", 30, "דנה כהן");
    await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי");

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );
    expect(out.pending).toBeUndefined();
    expect(out.spoken).toContain("איזה מהם להחליף?");

    const picked = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", first_time: "12:00", second_name: "רונית" },
      s.ctx,
    );
    expect(picked.pending?.kind).toBe("swap");
  });

  it("says whom each client will be with when the providers change", async () => {
    const s = await teamShop();
    await bookFor(s, "2026-09-04T07:00:00Z", 30, "דנה כהן", {
      staffId: s.shiran.id,
    });
    await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי", {
      staffId: s.maya.id,
    });

    const out = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );

    expect(out.spoken).toBe(
      "מחר התור של רונית לוי יעבור ל-10:00 אצל שירן, והתור של דנה כהן ל-14:00 אצל מאיה. להחליף?",
    );
  });
});

describe("executePending: a swap", () => {
  it("swaps both at once — including back to back, where one move alone would clash", async () => {
    const s = await shop();
    const dana = await bookFor(s, "2026-09-04T07:00:00Z", 60, "דנה כהן");
    const ronit = await bookFor(s, "2026-09-04T08:00:00Z", 30, "רונית לוי");

    const proposed = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );
    const done = await executePending(proposed.pending!, s.ctx);

    expect(done.actionTaken).toBe("confirmed");
    expect(done.spoken).toBe("החלפתי: רונית לוי ב-10:00 ודנה כהן ב-10:30.");
    expect(done.changed).toEqual({
      kind: "swapped",
      appointmentIds: [dana.id, ronit.id],
    });
    expect(done.aftermath?.map((item) => item.kind)).toEqual([
      "moved",
      "moved",
    ]);

    const byId = new Map(
      (await rowsOf(s.business.id)).map((row) => [row.id, row]),
    );
    expect(byId.get(ronit.id)?.startsAt.toISOString()).toBe(
      "2026-09-04T07:00:00.000Z",
    );
    expect(byId.get(ronit.id)?.endsAt.toISOString()).toBe(
      "2026-09-04T07:30:00.000Z",
    );
    expect(byId.get(dana.id)?.startsAt.toISOString()).toBe(
      "2026-09-04T07:30:00.000Z",
    );
    expect(byId.get(dana.id)?.endsAt.toISOString()).toBe(
      "2026-09-04T08:30:00.000Z",
    );
  });

  it("refuses when one of them moved since she asked", async () => {
    const s = await shop();
    const dana = await bookFor(s, "2026-09-04T07:00:00Z", 30, "דנה כהן");
    const ronit = await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי");

    const proposed = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );
    await db
      .update(appointments)
      .set({
        startsAt: new Date("2026-09-04T13:00:00Z"),
        endsAt: new Date("2026-09-04T13:30:00Z"),
      })
      .where(eq(appointments.id, ronit.id));

    const out = await executePending(proposed.pending!, s.ctx);
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("השתנו");

    const rows = await rowsOf(s.business.id);
    expect(rows.find((r) => r.id === dana.id)?.startsAt).toEqual(dana.startsAt);
  });

  it("leaves both alone when a third booking takes part of a place while she asks", async () => {
    const s = await shop();
    const dana = await bookFor(s, "2026-09-04T07:00:00Z", 60, "דנה כהן");
    const ronit = await bookFor(s, "2026-09-04T11:00:00Z", 30, "רונית לוי");

    const proposed = await runVoiceTool(
      "propose_swap_appointments",
      { first_name: "דנה", second_name: "רונית" },
      s.ctx,
    );
    expect(proposed.pending?.kind).toBe("swap");

    // דנה's hour at 14:00 needs 14:30 too, and עומר takes it before the "כן".
    await bookFor(s, "2026-09-04T11:30:00Z", 30, "עומר");

    const out = await executePending(proposed.pending!, s.ctx);
    expect(out.actionTaken).toBe("none");
    expect(out.spoken).toContain("עומר");

    const rows = await rowsOf(s.business.id);
    expect(rows.find((r) => r.id === dana.id)?.startsAt).toEqual(dana.startsAt);
    expect(rows.find((r) => r.id === ronit.id)?.startsAt).toEqual(
      ronit.startsAt,
    );
  });

  it("cannot reach another tenant's appointments", async () => {
    const mine = await shop();
    const theirs = await shop();
    const a = await bookFor(theirs, "2026-09-04T07:00:00Z", 30, "א");
    const b = await bookFor(theirs, "2026-09-04T11:00:00Z", 30, "ב");

    const forged: PendingAction = {
      kind: "swap",
      first: {
        appointmentId: a.id,
        clientName: "א",
        when: "10:00",
        toWhen: "14:00",
        startsAtIso: a.startsAt.toISOString(),
        targetStartsAtIso: b.startsAt.toISOString(),
      },
      second: {
        appointmentId: b.id,
        clientName: "ב",
        when: "14:00",
        toWhen: "10:00",
        startsAtIso: b.startsAt.toISOString(),
        targetStartsAtIso: a.startsAt.toISOString(),
      },
    };

    const out = await executePending(forged, mine.ctx);
    expect(out.actionTaken).toBe("none");
    const rows = await rowsOf(theirs.business.id);
    expect(rows.find((r) => r.id === a.id)?.startsAt).toEqual(a.startsAt);
  });
});

/* -------------------------------------------------------------------------- */
/* The week, and next week.                                                   */
/* -------------------------------------------------------------------------- */

describe("get_week_summary", () => {
  it("counts next week, Sunday to Saturday, and names the busiest day", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "השבוע");
    await book(s, "2026-09-06T06:00:00Z", "ראשון 1");
    await book(s, "2026-09-06T07:00:00Z", "ראשון 2");
    await book(s, "2026-09-08T06:00:00Z", "שלישי 1");
    await book(s, "2026-09-08T07:00:00Z", "שלישי 2");
    await book(s, "2026-09-08T08:00:00Z", "שלישי 3");
    await book(s, "2026-09-12T15:00:00Z", "שבת בערב");
    await book(s, "2026-09-13T06:00:00Z", "השבוע שאחרי");

    const out = await runVoiceTool("get_week_summary", { week: "next" }, s.ctx);

    expect(out.actionTaken).toBe("get_week_summary");
    expect(out.spoken).toBe(
      "בשבוע הבא יש לך 6 תורים ב-3 ימים. הכי עמוס ביום שלישי, עם 3 תורים.",
    );
    expect(out.navigate).toBeUndefined();
  });

  it("counts what is left of this week, from now", async () => {
    // It is Thursday at 12:00. This morning is behind; Sunday is next week.
    const s = await shop();
    await book(s, "2026-09-03T06:00:00Z", "הבוקר");
    await book(s, "2026-09-03T13:00:00Z", "דנה");
    await book(s, "2026-09-05T07:00:00Z", "רונית");
    await book(s, "2026-09-06T07:00:00Z", "ראשון");

    const out = await runVoiceTool("get_week_summary", { week: "this" }, s.ctx);

    expect(out.spoken).toBe(
      "השבוע נשארו לך 2 תורים: דנה היום ב-16:00, ורונית ביום שבת ב-10:00.",
    );
  });

  it("says an empty week is empty", async () => {
    const s = await shop();
    const out = await runVoiceTool("get_week_summary", { week: "next" }, s.ctx);
    expect(out.spoken).toBe("אין לך תורים בשבוע הבא.");
  });

  it("opens the calendar on that week when asked to show it", async () => {
    const s = await shop();
    const out = await runVoiceTool(
      "get_week_summary",
      { week: "next", show: true },
      s.ctx,
    );
    expect(out.navigate?.href).toBe(
      "/dashboard/agenda/full?week=2026-09-06&view=week",
    );
  });

  it("stays inside the tenant", async () => {
    const mine = await shop();
    const theirs = await shop();
    await book(theirs, "2026-09-07T07:00:00Z", "של מישהו אחר");

    const out = await runVoiceTool(
      "get_week_summary",
      { week: "next" },
      mine.ctx,
    );
    expect(out.spoken).toBe("אין לך תורים בשבוע הבא.");
  });
});

describe("upcomingRoster reaches next week", () => {
  it("runs to the Saturday that ends next week, and stops there", async () => {
    // Thursday the 3rd: next week is the 6th to the 12th.
    const s = await shop();
    await book(s, "2026-09-12T17:00:00Z", "שבת בערב");
    await book(s, "2026-09-13T06:00:00Z", "השבוע שאחרי");

    const names = (await upcomingRoster(s.ctx)).map((row) => row.clientName);
    expect(names).toContain("שבת בערב");
    expect(names).not.toContain("השבוע שאחרי");
  });
});

/* -------------------------------------------------------------------------- */
/* What a write tells the screen, and what it still owes.                     */
/* -------------------------------------------------------------------------- */

describe("what a turn changed", () => {
  it("tells the screen when it booked, and only then", async () => {
    const s = await shop();

    const created = await runVoiceTool(
      "create_appointment",
      { name: "דני", date: "2026-09-04", time: "15:00" },
      s.ctx,
    );
    const [row] = await rowsOf(s.business.id);
    expect(created.changed).toEqual({
      kind: "created",
      appointmentIds: [row.id],
    });

    // Reads, proposals and questions change nothing on screen.
    const quiet: [string, Record<string, unknown>][] = [
      ["get_next_appointment", {}],
      ["get_week_summary", { week: "next" }],
      ["find_client_appointments", { name: "דני" }],
      ["propose_cancel_appointment", { name: "דני" }],
      ["propose_reschedule_appointment", { name: "דני", time: "17:00" }],
      ["create_appointment", { name: "אחר" }],
    ];
    for (const [name, args] of quiet) {
      const out = await runVoiceTool(name, args, s.ctx);
      expect(out.changed, name).toBeUndefined();
      expect(out.aftermath, name).toBeUndefined();
    }
  });

  it("owes the cancelled client a notice, and the moved one a new reminder", async () => {
    const s = await shop();
    const dana = await book(s, "2026-09-04T07:00:00Z", "דנה כהן");
    const ronit = await book(s, "2026-09-05T07:00:00Z", "רונית לוי");

    const cancel = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );
    const cancelled = await executePending(cancel.pending!, s.ctx);
    expect(cancelled.changed).toEqual({
      kind: "cancelled",
      appointmentIds: [dana.id],
    });
    expect(cancelled.aftermath).toEqual([
      expect.objectContaining({ kind: "cancelled", wasRequest: false }),
    ]);

    const move = await runVoiceTool(
      "propose_reschedule_appointment",
      { name: "רונית", time: "17:00" },
      s.ctx,
    );
    const moved = await executePending(move.pending!, s.ctx);
    expect(moved.changed).toEqual({
      kind: "moved",
      appointmentIds: [ronit.id],
    });
    const [owed] = moved.aftermath ?? [];
    expect(owed?.kind).toBe("moved");
    // The row as it is *after* the move — the one a reminder must be planned on.
    expect(owed?.appointment.startsAt.toISOString()).toBe(
      "2026-09-05T14:00:00.000Z",
    );
  });

  it("tells a turned-down request it was turned down, not cancelled", async () => {
    const s = await shop();
    await book(s, "2026-09-04T07:00:00Z", "דנה כהן", { status: "pending" });

    const cancel = await runVoiceTool(
      "propose_cancel_appointment",
      { name: "דנה" },
      s.ctx,
    );
    const out = await executePending(cancel.pending!, s.ctx);
    expect(out.aftermath).toEqual([
      expect.objectContaining({ kind: "cancelled", wasRequest: true }),
    ]);
  });
});

describe("routeByVerb", () => {
  /**
   * Found in the browser: "תזיזי את התור של רפאל שטרן", transcribed
   * perfectly, went to the lookup and came back as a reading of the booking
   * instead of the question "לאיזו שעה או לאיזה יום להזיז אותו?".
   */
  it("sends a move the model read as a lookup to the move", () => {
    for (const said of [
      "תזיזי את התור של רפאל שטרן.",
      "תדחי את רפאל",
      "אפשר להזיז את רפאל?",
      "תקדימי את התור של רפאל",
      "תעבירי את רפאל",
    ]) {
      expect(
        routeByVerb("find_client_appointments", { name: "רפאל" }, said),
        said,
      ).toEqual({
        tool: "propose_reschedule_appointment",
        args: { name: "רפאל" },
      });
    }
  });

  it("leaves a real lookup alone", () => {
    expect(
      routeByVerb("find_client_appointments", { name: "רפאל" }, "מתי מגיע רפאל?"),
    ).toEqual({ tool: "find_client_appointments", args: { name: "רפאל" } });
  });

  it("only ever turns a read into a proposal, never anything else", () => {
    // A booking with a move verb in it is still a booking; a cancel is still
    // a cancel. Only the one direction that cannot write is taken.
    for (const tool of ["create_appointment", "propose_cancel_appointment"]) {
      expect(routeByVerb(tool, { name: "רפאל" }, "תזיזי את רפאל").tool).toBe(tool);
    }
  });

  it("lands on a question, and writes nothing", async () => {
    const s = await shop();
    await book(s, "2026-09-06T09:10:00Z", "רפאל שטרן");

    const routed = routeByVerb(
      "find_client_appointments",
      { name: "רפאל שטרן" },
      "תזיזי את התור של רפאל שטרן.",
    );
    const out = await runVoiceTool(routed.tool, routed.args, s.ctx);

    expect(out.spoken).toBe(
      "מצאתי תור של רפאל שטרן ביום ראשון ב-12:10. לאיזו שעה או לאיזה יום להזיז אותו?",
    );
    expect(out.draft?.kind).toBe("move");
    expect(out.pending).toBeUndefined();
  });
});
