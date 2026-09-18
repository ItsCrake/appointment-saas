import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  rescheduleAppointment,
  updateAppointmentStatus,
} from "@/db/queries/appointments";
import type { Database } from "@/db/types";
import { enqueueReminder } from "@/lib/notifications/enqueue";
import {
  createAppointment,
  createBusiness,
  createService,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

import {
  afterAppointmentCancelled,
  afterAppointmentMoved,
  settleAftermath,
} from "./appointment-aftermath";

/**
 * What a move or a cancellation owes the client, wherever it was made.
 *
 * ---------------------------------------------------------------------------
 * **These were two copies, and they disagreed.** The dashboard's buttons
 * re-planned a moved booking's reminder and told a cancelled client; ליבי's
 * spoken "כן" made the same change and did neither. So what is pinned here is
 * the behaviour every path now shares — and that it can never turn a change
 * that has already been written into an error.
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

beforeEach(async () => {
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

/**
 * Far enough ahead that a reminder is always still to come, whatever the
 * machine's clock says — `enqueueReminder` plans against the real now.
 */
const at = (iso: string) => new Date(`${iso}+02:00`);

async function booked(overrides: Parameters<typeof createAppointment>[5] = {}) {
  const business = await createBusiness(db);
  const service = await createService(db, business.id, { durationMin: 30 });
  const appointment = await createAppointment(
    db,
    business.id,
    service.id,
    at("2027-03-10T10:00:00"),
    at("2027-03-10T10:30:00"),
    { clientEmail: "client@example.test", ...overrides },
  );
  return { business, appointment };
}

const notificationsFor = (appointmentId: string) =>
  db.query.notifications.findMany({
    where: (n, { eq }) => eq(n.appointmentId, appointmentId),
  });

describe("afterAppointmentMoved", () => {
  it("replaces the reminder with one for the new time", async () => {
    /**
     * The reminder is keyed on the appointment, not the time, so the old row
     * would swallow a new one — and fire a day before an hour that no longer
     * holds anything.
     */
    const { business, appointment } = await booked();
    await enqueueReminder({ db, business, appointment });

    const moved = await rescheduleAppointment(db, business.id, appointment.id, {
      startsAt: at("2027-03-12T10:00:00"),
      endsAt: at("2027-03-12T10:30:00"),
    });
    await afterAppointmentMoved({
      db,
      business,
      appointment: moved!,
      source: "test",
    });

    const rows = await notificationsFor(appointment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("reminder");
    expect(rows[0].status).toBe("pending");
    expect(rows[0].scheduledFor.toISOString()).toBe(
      new Date(at("2027-03-12T10:00:00").getTime() - 24 * 3_600_000).toISOString(),
    );
  });
});

describe("afterAppointmentCancelled", () => {
  it("stops the reminder and tells the client", async () => {
    const { business, appointment } = await booked();
    await enqueueReminder({ db, business, appointment });

    const cancelled = await updateAppointmentStatus(
      db,
      business.id,
      appointment.id,
      "cancelled",
    );
    await afterAppointmentCancelled({
      db,
      business,
      appointment: cancelled!,
      wasRequest: false,
      source: "test",
    });

    const rows = await notificationsFor(appointment.id);
    const byKind = new Map(rows.map((row) => [row.kind, row]));
    expect(byKind.get("reminder")?.status).toBe("skipped");
    expect(byKind.get("cancellation_confirmation")?.status).toBe("pending");
  });

  it("tells a turned-down request it was turned down", async () => {
    const { business, appointment } = await booked({ status: "pending" });

    const cancelled = await updateAppointmentStatus(
      db,
      business.id,
      appointment.id,
      "cancelled",
    );
    await afterAppointmentCancelled({
      db,
      business,
      appointment: cancelled!,
      wasRequest: true,
      source: "test",
    });

    const kinds = (await notificationsFor(appointment.id)).map((row) => row.kind);
    expect(kinds).toContain("booking_rejected");
    expect(kinds).not.toContain("cancellation_confirmation");
  });

  it("queues nothing for a voice placeholder, which has nobody to tell", async () => {
    const { business, appointment } = await booked({
      clientEmail: null,
      clientPhone: "",
      isVoicePlaceholder: true,
    });

    const cancelled = await updateAppointmentStatus(
      db,
      business.id,
      appointment.id,
      "cancelled",
    );
    await afterAppointmentCancelled({
      db,
      business,
      appointment: cancelled!,
      wasRequest: false,
      source: "test",
    });

    const toClient = (await notificationsFor(appointment.id)).filter(
      (row) => row.kind === "cancellation_confirmation",
    );
    expect(toClient).toHaveLength(0);
  });
});

describe("settleAftermath", () => {
  it("never turns a change that was already written into an error", async () => {
    // A database that has gone away mid-turn. The move happened; the owner
    // must not be told it failed, or they will make it again.
    const { business, appointment } = await booked();
    const gone = new Proxy({} as Database, {
      get() {
        throw new Error("database unreachable");
      },
    });

    await expect(
      settleAftermath({
        db: gone,
        business,
        source: "test",
        owed: [
          { kind: "moved", appointment },
          { kind: "cancelled", appointment, wasRequest: false },
        ],
      }),
    ).resolves.toBeUndefined();
  });
});
