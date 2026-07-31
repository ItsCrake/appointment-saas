import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { appointments } from "@/db/schema";
import type { Database } from "@/db/types";
import { getAvailableSlots, weekdayOf } from "@/lib/availability";
import {
  createAppointment,
  createBusiness,
  createService,
  createShift,
  createTimeOff,
  TZ,
} from "@/test/factories";
import { createTestDb } from "@/test/pglite";

/** Monday, high summer — Israel is on IDT (UTC+3), so 09:00 local = 06:00Z. */
const DATE = "2026-08-03";
const WEEKDAY = weekdayOf(DATE);
/** Well before DATE, so notice/horizon rules never fire unless a test wants them. */
const NOW = new Date("2026-07-01T00:00:00Z");

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
  // Cheaper than rebuilding PGlite per test; cascades clear every child table.
  await harness.pg.exec("TRUNCATE businesses CASCADE");
});

async function setup(
  businessOverrides: Parameters<typeof createBusiness>[1] = {},
  serviceOverrides: Parameters<typeof createService>[2] = {},
) {
  const business = await createBusiness(db, businessOverrides);
  const service = await createService(db, business.id, serviceOverrides);
  return { business, service };
}

function labels(slots: { label: string }[]) {
  return slots.map((s) => s.label);
}

describe("getAvailableSlots — base generation", () => {
  it("steps by slot_interval_min and never runs past the shift end", async () => {
    const { business, service } = await setup();
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    // 09:00→11:30 inclusive, every 15 min: a 30-min service must end by 12:00.
    expect(labels(slots)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
      "11:15",
      "11:30",
    ]);
  });

  it("returns UTC instants that match the business timezone offset", async () => {
    const { business, service } = await setup();
    await createShift(db, business.id, WEEKDAY, "09:00:00", "10:00:00");

    const [first] = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    // IDT is UTC+3 in August.
    expect(first.startsAt).toBe("2026-08-03T06:00:00.000Z");
    expect(first.endsAt).toBe("2026-08-03T06:30:00.000Z");
    expect(first.label).toBe("09:00");
  });

  it("honours the winter offset on the same shift definition", async () => {
    const winter = "2026-12-07";
    const { business, service } = await setup();
    await createShift(
      db,
      business.id,
      weekdayOf(winter),
      "09:00:00",
      "10:00:00",
    );

    const [first] = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: winter,
      now: NOW,
    });

    // IST is UTC+2 in December — same wall clock, different instant.
    expect(first.startsAt).toBe("2026-12-07T07:00:00.000Z");
    expect(first.label).toBe("09:00");
  });
});

describe("getAvailableSlots — split shifts", () => {
  it("offers both shifts and nothing inside the break", async () => {
    const { business, service } = await setup();
    await createShift(db, business.id, WEEKDAY, "09:00:00", "13:00:00");
    await createShift(db, business.id, WEEKDAY, "14:00:00", "19:00:00");

    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });
    const got = labels(slots);

    // Last slot of the morning ends exactly at 13:00.
    expect(got).toContain("12:30");
    // Would end 13:15, past the shift end.
    expect(got).not.toContain("12:45");
    // The break itself is unbookable.
    expect(got).not.toContain("13:00");
    expect(got).not.toContain("13:30");
    // Afternoon resumes.
    expect(got).toContain("14:00");
    expect(got).toContain("18:30");
    expect(got).not.toContain("18:45");
  });
});

describe("getAvailableSlots — closed days", () => {
  it("returns nothing when the weekday has no shifts", async () => {
    const { business, service } = await setup();
    await createShift(
      db,
      business.id,
      (WEEKDAY + 1) % 7,
      "09:00:00",
      "17:00:00",
    );

    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    expect(slots).toEqual([]);
  });

  it("returns nothing when the weekday is explicitly marked closed", async () => {
    const { business, service } = await setup();
    await createShift(db, business.id, WEEKDAY, "00:00:00", "00:00:00", true);

    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW,
    });

    expect(slots).toEqual([]);
  });
});

describe("getAvailableSlots — existing appointments", () => {
  it("frees the adjacent slot when there is no buffer (back-to-back)", async () => {
    const { business, service } = await setup({ bufferMin: 0 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"), // 09:00 local
      new Date("2026-08-03T06:30:00Z"), // 09:30 local
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).not.toContain("09:00");
    expect(got).not.toContain("09:15");
    expect(got).toContain("09:30"); // starts the instant the other ends
    expect(got[0]).toBe("09:30"); // and it is the first offer of the day
  });

  it("blocks a candidate that merely overlaps the tail of a booking", async () => {
    const { business, service } = await setup({ bufferMin: 0 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:30:00Z"), // 09:30
      new Date("2026-08-03T07:00:00Z"), // 10:00
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).toContain("09:00"); // 09:00–09:30 fits before it
    expect(got).not.toContain("09:15"); // would run to 09:45
    expect(got).not.toContain("09:30");
    expect(got).not.toContain("09:45");
    expect(got).toContain("10:00");
  });

  it("ignores cancelled and no-show appointments", async () => {
    const { business, service } = await setup({ bufferMin: 0 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
      { status: "cancelled" },
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).toContain("09:00");
  });

  it("does not leak bookings across tenants", async () => {
    const { business, service } = await setup({ bufferMin: 0 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    const other = await createBusiness(db);
    const otherService = await createService(db, other.id);
    await createAppointment(
      db,
      other.id,
      otherService.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).toContain("09:00");
  });
});

describe("getAvailableSlots — buffer margins", () => {
  it("enforces the gap on both sides of an existing booking", async () => {
    const { business, service } = await setup({ bufferMin: 15 });
    await createShift(db, business.id, WEEKDAY, "08:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"), // 09:00 local
      new Date("2026-08-03T06:30:00Z"), // 09:30 local
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    // After: needs 15 min clear, so 09:30 is out and 09:45 is the first.
    expect(got).not.toContain("09:30");
    expect(got).toContain("09:45");
    // Before: 08:30–09:00 leaves no gap; 08:15–08:45 leaves exactly 15 min.
    expect(got).not.toContain("08:30");
    expect(got).toContain("08:15");
  });

  it("lets a service override the business buffer", async () => {
    // Business says 0, the service demands 15.
    const { business, service } = await setup(
      { bufferMin: 0 },
      { bufferMin: 15 },
    );
    await createShift(db, business.id, WEEKDAY, "08:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"), // 09:00
      new Date("2026-08-03T06:30:00Z"), // 09:30
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).not.toContain("09:30");
    expect(got).toContain("09:45");
  });

  it("treats a service buffer of 0 as an override, not a fallback", async () => {
    // The business demands 15; this service explicitly wants none.
    const { business, service } = await setup(
      { bufferMin: 15 },
      { bufferMin: 0 },
    );
    await createShift(db, business.id, WEEKDAY, "08:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).toContain("09:30"); // back-to-back allowed again
  });

  it("falls back to the business buffer when the service leaves it null", async () => {
    const { business, service } = await setup(
      { bufferMin: 15 },
      { bufferMin: null },
    );
    await createShift(db, business.id, WEEKDAY, "08:00:00", "12:00:00");
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).not.toContain("09:30");
    expect(got).toContain("09:45");
  });

  it("does not require a buffer against the shift boundary itself", async () => {
    const { business, service } = await setup({ bufferMin: 15 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got[0]).toBe("09:00");
    expect(got.at(-1)).toBe("11:30");
  });
});

describe("getAvailableSlots — time off", () => {
  it("removes slots overlapping a closure, with no buffer applied", async () => {
    const { business, service } = await setup({ bufferMin: 0 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "13:00:00");
    await createTimeOff(
      db,
      business.id,
      new Date("2026-08-03T07:00:00Z"), // 10:00 local
      new Date("2026-08-03T08:00:00Z"), // 11:00 local
    );

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    );

    expect(got).toContain("09:30"); // ends exactly at 10:00
    expect(got).not.toContain("09:45");
    expect(got).not.toContain("10:00");
    expect(got).not.toContain("10:30");
    expect(got).toContain("11:00"); // starts exactly when it ends
  });
});

describe("getAvailableSlots — booking window", () => {
  it("drops slots inside the minimum notice period", async () => {
    const { business, service } = await setup({ minNoticeMin: 60 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    const got = labels(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        // 08:30 local on the day itself → earliest bookable is 09:30.
        now: new Date("2026-08-03T05:30:00Z"),
      }),
    );

    expect(got).not.toContain("09:00");
    expect(got).not.toContain("09:15");
    expect(got[0]).toBe("09:30");
  });

  it("drops the whole day when it is beyond max_advance_days", async () => {
    const { business, service } = await setup({ maxAdvanceDays: 7 });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    const slots = await getAvailableSlots(db, {
      businessId: business.id,
      serviceId: service.id,
      date: DATE,
      now: NOW, // a month out
    });

    expect(slots).toEqual([]);
  });
});

describe("getAvailableSlots — guards", () => {
  it("returns nothing for an inactive service", async () => {
    const { business, service } = await setup({}, { isActive: false });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    expect(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("returns nothing when the service belongs to another business", async () => {
    const { business } = await setup();
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");
    const other = await createBusiness(db);
    const foreign = await createService(db, other.id);

    expect(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: foreign.id,
        date: DATE,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("returns nothing for an inactive business", async () => {
    const { business, service } = await setup({ isActive: false });
    await createShift(db, business.id, WEEKDAY, "09:00:00", "12:00:00");

    expect(
      await getAvailableSlots(db, {
        businessId: business.id,
        serviceId: service.id,
        date: DATE,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe("database double-booking guard", () => {
  it("rejects an overlapping insert even when availability says otherwise", async () => {
    const { business, service } = await setup();
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    // Drizzle wraps driver errors, so the constraint name lives on the cause.
    const error = await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:15:00Z"),
      new Date("2026-08-03T06:45:00Z"),
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).cause ?? error)).toMatch(
      /appointments_no_overlap/,
    );
  });

  it("allows the same instant for a different business", async () => {
    const { business, service } = await setup();
    await createAppointment(
      db,
      business.id,
      service.id,
      new Date("2026-08-03T06:00:00Z"),
      new Date("2026-08-03T06:30:00Z"),
    );

    const other = await createBusiness(db);
    const otherService = await createService(db, other.id);

    await expect(
      createAppointment(
        db,
        other.id,
        otherService.id,
        new Date("2026-08-03T06:00:00Z"),
        new Date("2026-08-03T06:30:00Z"),
      ),
    ).resolves.toMatchObject({ businessId: other.id });
  });

  it("stores timestamps in UTC regardless of the business timezone", async () => {
    const { business, service } = await setup();
    const startsAt = new Date("2026-08-03T06:00:00Z");
    await createAppointment(
      db,
      business.id,
      service.id,
      startsAt,
      new Date("2026-08-03T06:30:00Z"),
    );

    const [row] = await db.select().from(appointments);
    expect(row.startsAt.toISOString()).toBe(startsAt.toISOString());
    expect(business.timezone).toBe(TZ);
  });
});
