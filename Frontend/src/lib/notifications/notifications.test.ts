import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  cancelPendingNotificationsForAppointment,
  listDueNotifications,
  listRecentNotifications,
} from "@/db/queries/notifications";
import { notifications } from "@/db/schema";
import type { Database } from "@/db/types";
import { dispatchDueNotifications } from "@/lib/notifications/dispatch";
import {
  enqueueApprovalNotifications,
  enqueueBookingNotifications,
  enqueueCancellationNotifications,
  enqueueRejectionNotifications,
} from "@/lib/notifications/enqueue";
import { toE164 } from "@/lib/notifications/providers";
import { renderNotification } from "@/lib/notifications/templates";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

let harness: Awaited<ReturnType<typeof createTestDb>>;
let db: Database;

const NOW = new Date("2026-08-01T09:00:00Z");
const START = new Date("2026-08-03T06:00:00Z"); // 09:00 Israel

beforeAll(async () => {
  harness = await createTestDb();
  db = harness.db;
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

async function scenario(
  businessOverrides: Parameters<typeof createBusiness>[1] = {},
  appointmentOverrides: Parameters<typeof createAppointment>[5] = {},
) {
  const business = await createBusiness(db, {
    notificationEmail: "owner@shop.test",
    reminderHoursBefore: 24,
    ...businessOverrides,
  });
  const service = await createService(db, business.id);
  const appointment = await createAppointment(
    db,
    business.id,
    service.id,
    START,
    new Date(START.getTime() + 30 * 60_000),
    { clientEmail: "client@example.test", ...appointmentOverrides },
  );
  return { business, service, appointment };
}

describe("enqueueBookingNotifications", () => {
  it("queues the client confirmation, owner alert and reminder", async () => {
    const { business, appointment } = await scenario();

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued.sort()).toEqual([
      "booking_alert",
      "booking_confirmation",
      "reminder",
    ]);

    const rows = await listRecentNotifications(db, business.id);
    const reminder = rows.find((r) => r.kind === "reminder")!;
    // 24 hours before 09:00 Israel on the 3rd.
    expect(reminder.scheduledFor.toISOString()).toBe(
      "2026-08-02T06:00:00.000Z",
    );
    expect(reminder.recipient).toBe("client@example.test");
  });

  it("is idempotent — a retried action cannot double-send", async () => {
    const { business, appointment } = await scenario();

    await enqueueBookingNotifications({ db, business, appointment, now: NOW });
    const second = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(second).toEqual([]);
    expect(await listRecentNotifications(db, business.id)).toHaveLength(3);
  });

  it("skips client messages when no email was given", async () => {
    const { business, appointment } = await scenario({}, { clientEmail: null });

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued).toEqual(["booking_alert"]);
  });

  it("skips the owner alert when no notification email is configured", async () => {
    const { business, appointment } = await scenario({
      notificationEmail: null,
    });

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued.sort()).toEqual(["booking_confirmation", "reminder"]);
  });

  it("does not schedule a reminder whose send time has already passed", async () => {
    const { business, appointment } = await scenario();

    // Booked 2 hours before the appointment: the 24h reminder is moot.
    const lateNow = new Date(START.getTime() - 2 * 3_600_000);
    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: lateNow,
    });

    expect(queued).not.toContain("reminder");
  });

  it("honours reminder_hours_before = 0 as disabled", async () => {
    const { business, appointment } = await scenario({
      reminderHoursBefore: 0,
    });

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued).not.toContain("reminder");
  });
});

describe("dispatchDueNotifications", () => {
  it("sends only what is due, leaving the future reminder queued", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });

    const summary = await dispatchDueNotifications(db, { now: NOW });

    expect(summary).toMatchObject({ considered: 2, sent: 2, failed: 0 });

    const rows = await listRecentNotifications(db, business.id);
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.status]));
    expect(byKind.booking_confirmation).toBe("sent");
    expect(byKind.booking_alert).toBe("sent");
    expect(byKind.reminder).toBe("pending");
  });

  it("sends the reminder once its time arrives, and never twice", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });

    const reminderTime = new Date("2026-08-02T06:00:00.000Z");
    const first = await dispatchDueNotifications(db, { now: reminderTime });
    expect(first.sent).toBe(3); // the two immediates plus the reminder

    const second = await dispatchDueNotifications(db, { now: reminderTime });
    expect(second).toMatchObject({ considered: 0, sent: 0 });
  });

  it("skips a reminder for an appointment that was cancelled", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });
    await dispatchDueNotifications(db, { now: NOW }); // clear the immediates

    await harness.pg.exec(
      `UPDATE appointments SET status = 'cancelled' WHERE id = '${appointment.id}'`,
    );

    const summary = await dispatchDueNotifications(db, {
      now: new Date("2026-08-02T06:00:00.000Z"),
    });

    expect(summary).toMatchObject({ considered: 1, sent: 0, skipped: 1 });

    const rows = await listRecentNotifications(db, business.id);
    const reminder = rows.find((r) => r.kind === "reminder")!;
    expect(reminder.status).toBe("skipped");
    expect(reminder.lastError).toContain("cancelled");
  });

  it("marks messages sent with a timestamp and an attempt count", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });
    await dispatchDueNotifications(db, { now: NOW });

    const rows = await listRecentNotifications(db, business.id);
    const sent = rows.filter((r) => r.status === "sent");
    for (const row of sent) {
      expect(row.sentAt).toBeInstanceOf(Date);
      expect(row.attempts).toBe(1);
      expect(row.lastError).toBeNull();
    }
  });
});

describe("cancellation flow", () => {
  it("drops the queued reminder and queues cancellation messages", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });

    const dropped = await cancelPendingNotificationsForAppointment(
      db,
      appointment.id,
    );
    // The two immediates are still pending too, so all three are dropped.
    expect(dropped).toBe(3);

    const queued = await enqueueCancellationNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });
    expect(queued.sort()).toEqual([
      "cancellation_alert",
      "cancellation_confirmation",
    ]);

    const due = await listDueNotifications(db, NOW);
    expect(due).toHaveLength(2);
  });
});

describe("enqueue — requires approval (0019)", () => {
  it("sends a request message instead of a confirmation", async () => {
    const { business, appointment } = await scenario(
      { requiresApproval: true },
      { status: "pending" },
    );

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued).toContain("booking_pending");
    expect(queued).not.toContain("booking_confirmation");
  });

  it("withholds the reminder until the answer is known", async () => {
    // Reminding someone about an appointment the owner has not agreed to is
    // the same lie as the confirmation, arriving the day before instead.
    const { business, appointment } = await scenario(
      { requiresApproval: true },
      { status: "pending" },
    );

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued).not.toContain("reminder");
  });

  it("still alerts the owner, who is the one who has to answer", async () => {
    const { business, appointment } = await scenario(
      { requiresApproval: true },
      { status: "pending" },
    );

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued).toContain("booking_alert");
  });

  it("schedules the reminder at approval, not before", async () => {
    const { business, appointment } = await scenario(
      { requiresApproval: true },
      { status: "pending" },
    );

    await enqueueBookingNotifications({ db, business, appointment, now: NOW });

    // The row the action passes on is the one *after* the update.
    const approved = { ...appointment, status: "confirmed" as const };
    const queued = await enqueueApprovalNotifications({
      db,
      business,
      appointment: approved,
      now: NOW,
    });

    expect(queued.sort()).toEqual(["booking_approved", "reminder"]);
  });

  it("rejects without telling the client their booking was cancelled", async () => {
    const { business, appointment } = await scenario(
      { requiresApproval: true },
      { status: "pending" },
    );

    const queued = await enqueueRejectionNotifications({
      db,
      business,
      appointment: { ...appointment, status: "cancelled" as const },
      now: NOW,
    });

    expect(queued).toEqual(["booking_rejected"]);
    // No owner alert: the owner is the one who just did it.
    expect(queued).not.toContain("cancellation_alert");
  });

  it("leaves a tenant without the flag exactly as it was", async () => {
    const { business, appointment } = await scenario();

    const queued = await enqueueBookingNotifications({
      db,
      business,
      appointment,
      now: NOW,
    });

    expect(queued.sort()).toEqual([
      "booking_alert",
      "booking_confirmation",
      "reminder",
    ]);
  });
});

describe("templates", () => {
  const context = {
    kind: "booking_confirmation" as const,
    businessName: "מספרת ברקאי",
    businessPhone: "050-1234567",
    businessAddress: "דיזנגוף 100",
    businessTimezone: "Asia/Jerusalem",
    bookingUrl: "https://example.test/demo-barber",
    manageUrl: "https://example.test/b/token",
    manageToken: "token",
    clientName: "דני",
    serviceName: "תספורת גבר",
    priceCents: 7000,
    startsAt: START.toISOString(),
    status: "confirmed",
  };

  it("renders the local time, not UTC", () => {
    const { body } = renderNotification(context);
    expect(body).toContain("09:00"); // 06:00Z in Asia/Jerusalem
    expect(body).not.toContain("06:00");
  });

  it("includes the manage link in the confirmation", () => {
    const { body } = renderNotification(context);
    expect(body).toContain("https://example.test/b/token");
  });

  it("points a cancellation at the booking page instead", () => {
    const { body, subject } = renderNotification({
      ...context,
      kind: "cancellation_confirmation",
    });
    expect(subject).toContain("בוטל");
    expect(body).toContain("https://example.test/demo-barber");
  });

  it("gives the owner the client name in the subject", () => {
    const { subject } = renderNotification({
      ...context,
      kind: "booking_alert",
    });
    expect(subject).toContain("דני");
  });

  /**
   * "תורים באישור" (0019). The copy is the feature here as much as the status
   * column is: a client who reads a confirmation for a request that has not
   * been approved turns up to a shop that is not expecting them.
   */
  describe("requires approval", () => {
    it("never tells a pending client their appointment is booked", () => {
      const { subject, body } = renderNotification({
        ...context,
        kind: "booking_pending",
        status: "pending",
      });

      expect(subject).toContain("ממתינה לאישור");
      // The exact word a skim-reader looks for, and the one that would be a lie.
      expect(body).not.toContain("נקבע");
      // The time is genuinely held, so withdrawing has to be possible.
      expect(body).toContain("https://example.test/b/token");
    });

    it("says the request was approved, not merely booked", () => {
      const { subject, body } = renderNotification({
        ...context,
        kind: "booking_approved",
      });

      expect(subject).toContain("אושר");
      expect(body).toContain("09:00");
    });

    it("distinguishes a rejection from a cancellation", () => {
      // Both are `cancelled` in the database by dispatch time, which is exactly
      // why they are separate kinds — the status cannot tell them apart.
      const rejected = renderNotification({
        ...context,
        kind: "booking_rejected",
      });
      const cancelled = renderNotification({
        ...context,
        kind: "cancellation_confirmation",
      });

      expect(rejected.subject).toContain("לא אושרה");
      expect(rejected.subject).not.toContain("בוטל");
      expect(cancelled.subject).toContain("בוטל");
      // Both point back at the booking page: a refusal with no next step is
      // where a client gives up on a shop that would see them an hour later.
      expect(rejected.body).toContain("https://example.test/demo-barber");
    });

    it("tells the owner a request is waiting on them", () => {
      const waiting = renderNotification({
        ...context,
        kind: "booking_alert",
        status: "pending",
      });
      const booked = renderNotification({ ...context, kind: "booking_alert" });

      // The subject is the only part most owners read on a phone.
      expect(waiting.subject).toContain("ממתין לאישורך");
      expect(booked.subject).not.toContain("ממתין");
    });
  });
});

describe("toE164", () => {
  it.each([
    ["0501234567", "+972501234567"],
    ["050-123-4567", "+972501234567"],
    ["+972501234567", "+972501234567"],
    ["00972501234567", "+972501234567"],
    ["972501234567", "+972501234567"],
  ])("normalises %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });
});

describe("notification table constraints", () => {
  it("rejects a duplicate dedupe key at the database level", async () => {
    const { business, appointment } = await scenario();

    await db.insert(notifications).values({
      businessId: business.id,
      appointmentId: appointment.id,
      channel: "email",
      kind: "reminder",
      recipient: "a@b.test",
      scheduledFor: NOW,
      dedupeKey: "dupe-test",
    });

    await expect(
      db.insert(notifications).values({
        businessId: business.id,
        appointmentId: appointment.id,
        channel: "email",
        kind: "reminder",
        recipient: "a@b.test",
        scheduledFor: NOW,
        dedupeKey: "dupe-test",
      }),
    ).rejects.toThrow();
  });

  it("removes notifications when the appointment is deleted", async () => {
    const { business, appointment } = await scenario();
    await enqueueBookingNotifications({ db, business, appointment, now: NOW });

    await harness.pg.exec(
      `DELETE FROM appointments WHERE id = '${appointment.id}'`,
    );

    expect(await listRecentNotifications(db, business.id)).toHaveLength(0);
  });
});
