import { describe, expect, it } from "vitest";

import {
  describePreferences,
  entryMatchesSlot,
  inviteStateFor,
  matchesForSlot,
  offerDeadline,
  offerHasLapsed,
  windowForHour,
  type FreedSlot,
  type MatchableEntry,
} from "@/lib/waitlist";

/**
 * The matching rule, on its own.
 *
 * It decides who gets messaged about a real appointment, so every axis is
 * tested independently and both directions of each are asserted — a filter that
 * only ever passes is indistinguishable from no filter at all.
 */

const TZ = "Asia/Jerusalem";

/** 2026-08-04 is a Tuesday. IDT is +03. */
const TUESDAY = "2026-08-04";

const slotAt = (date: string, time: string): FreedSlot => ({
  startsAt: new Date(`${date}T${time}:00+03:00`),
  endsAt: new Date(`${date}T${time}:00+03:00`),
  staffId: "staff-a",
  serviceId: "service-a",
});

const entry = (overrides: Partial<MatchableEntry> = {}): MatchableEntry => ({
  status: "active",
  serviceId: null,
  preferredStaffId: null,
  preferredDays: [],
  preferredTimeWindow: "any",
  ...overrides,
});

describe("windowForHour", () => {
  it("splits the day where a working day actually bends", () => {
    expect(windowForHour(0)).toBe("morning");
    expect(windowForHour(11)).toBe("morning");
    expect(windowForHour(12)).toBe("afternoon");
    expect(windowForHour(16)).toBe("afternoon");
    expect(windowForHour(17)).toBe("evening");
    expect(windowForHour(23)).toBe("evening");
  });
});

describe("entryMatchesSlot", () => {
  const slot = slotAt(TUESDAY, "10:00");

  it("offers anything to somebody who asked for anything", () => {
    // The least fussy client is the easiest to place, and must not be filtered
    // out by reading their blanks as "no".
    expect(entryMatchesSlot(entry(), slot, TZ)).toBe(true);
  });

  it("keeps a named service to that service", () => {
    expect(entryMatchesSlot(entry({ serviceId: "service-a" }), slot, TZ)).toBe(
      true,
    );
    expect(entryMatchesSlot(entry({ serviceId: "service-b" }), slot, TZ)).toBe(
      false,
    );
  });

  it("keeps a named provider to that provider", () => {
    expect(
      entryMatchesSlot(entry({ preferredStaffId: "staff-a" }), slot, TZ),
    ).toBe(true);
    expect(
      entryMatchesSlot(entry({ preferredStaffId: "staff-b" }), slot, TZ),
    ).toBe(false);
  });

  it("keeps named days to those days", () => {
    // 2 is Tuesday on the Sunday-first basis the whole schema uses.
    expect(entryMatchesSlot(entry({ preferredDays: [2] }), slot, TZ)).toBe(
      true,
    );
    expect(entryMatchesSlot(entry({ preferredDays: [0, 4] }), slot, TZ)).toBe(
      false,
    );
    // Several days, one of which fits.
    expect(
      entryMatchesSlot(entry({ preferredDays: [1, 2, 3] }), slot, TZ),
    ).toBe(true);
  });

  it("keeps a named window to that window", () => {
    expect(
      entryMatchesSlot(entry({ preferredTimeWindow: "morning" }), slot, TZ),
    ).toBe(true);
    expect(
      entryMatchesSlot(entry({ preferredTimeWindow: "evening" }), slot, TZ),
    ).toBe(false);
    expect(
      entryMatchesSlot(
        entry({ preferredTimeWindow: "afternoon" }),
        slotAt(TUESDAY, "14:00"),
        TZ,
      ),
    ).toBe(true);
  });

  it("reads the day and the hour in the shop's clock, not the server's", () => {
    /**
     * The case that makes the timezone argument load-bearing: 22:00 UTC on a
     * Tuesday is 01:00 on **Wednesday** in Jerusalem. A matcher working in UTC
     * would offer this to somebody who said Tuesday evenings and hide it from
     * somebody who said Wednesday mornings — both wrong, and both invisible to
     * anyone testing from a machine set to Israel time.
     */
    const lateSlot: FreedSlot = {
      startsAt: new Date(`${TUESDAY}T22:00:00Z`),
      endsAt: new Date(`${TUESDAY}T23:00:00Z`),
      staffId: "staff-a",
      serviceId: "service-a",
    };

    // Wednesday is 3, and 01:00 is morning.
    expect(entryMatchesSlot(entry({ preferredDays: [3] }), lateSlot, TZ)).toBe(
      true,
    );
    expect(entryMatchesSlot(entry({ preferredDays: [2] }), lateSlot, TZ)).toBe(
      false,
    );
    expect(
      entryMatchesSlot(entry({ preferredTimeWindow: "morning" }), lateSlot, TZ),
    ).toBe(true);
  });

  it("still offers to somebody already notified", () => {
    // An unanswered offer is not a refusal, and the next cancellation is a
    // fresh chance.
    expect(entryMatchesSlot(entry({ status: "notified" }), slot, TZ)).toBe(
      true,
    );
  });

  it("never offers to somebody who has left the queue", () => {
    for (const status of ["booked", "cancelled", "expired"]) {
      expect(entryMatchesSlot(entry({ status }), slot, TZ)).toBe(false);
    }
  });

  it("requires every named preference at once", () => {
    // Each axis is a filter, so satisfying three and failing one is a miss.
    const fussy = entry({
      serviceId: "service-a",
      preferredStaffId: "staff-a",
      preferredDays: [2],
      preferredTimeWindow: "morning",
    });

    expect(entryMatchesSlot(fussy, slot, TZ)).toBe(true);
    expect(entryMatchesSlot(fussy, slotAt(TUESDAY, "18:00"), TZ)).toBe(false);
  });
});

describe("matchesForSlot", () => {
  it("puts the longest wait first", () => {
    const slot = slotAt(TUESDAY, "10:00");
    const rows = [
      { ...entry(), id: "new", createdAt: new Date("2026-08-01T00:00:00Z") },
      { ...entry(), id: "old", createdAt: new Date("2026-07-01T00:00:00Z") },
      { ...entry(), id: "mid", createdAt: new Date("2026-07-15T00:00:00Z") },
    ];

    expect(matchesForSlot(rows, slot, TZ).map((r) => r.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  it("drops the ones that do not fit", () => {
    const slot = slotAt(TUESDAY, "10:00");
    const rows = [
      {
        ...entry({ preferredTimeWindow: "evening" }),
        id: "evenings",
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      {
        ...entry(),
        id: "anything",
        createdAt: new Date("2026-07-02T00:00:00Z"),
      },
    ];

    expect(matchesForSlot(rows, slot, TZ).map((r) => r.id)).toEqual([
      "anything",
    ]);
  });
});

describe("describePreferences", () => {
  it("says any day when nothing was named", () => {
    expect(
      describePreferences({ preferredDays: [], preferredTimeWindow: "any" }),
    ).toBe("כל יום · כל שעה");
  });

  it("lists named days in week order, whatever order they arrived in", () => {
    expect(
      describePreferences({
        preferredDays: [3, 0],
        preferredTimeWindow: "morning",
      }),
    ).toBe("יום ראשון, יום רביעי · בוקר");
  });
});

describe("inviteStateFor", () => {
  const future = new Date("2026-08-04T10:00:00Z");
  const NOW = new Date("2026-08-01T00:00:00Z");
  /**
   * Expiry off for this block. Every case below is about one of the *other*
   * ways an offer stops being open — withdrawn, closed shop, slot gone, their
   * own booking — and pinning the window to 0 keeps a second clock out of
   * assertions that are not about it. The window has its own block further
   * down.
   */
  const live = { businessIsActive: true, slotTaken: false, offerTtlMin: 0 };

  const invite = (overrides: Record<string, unknown> = {}) => ({
    status: "notified",
    invitedAt: NOW,
    invitedStartsAt: future,
    invitedEndsAt: future,
    ...overrides,
  });

  it("offers a live slot", () => {
    expect(inviteStateFor(invite(), live, NOW)).toBe("open");
  });

  it("says taken when somebody else got there first", () => {
    expect(inviteStateFor(invite(), { ...live, slotTaken: true }, NOW)).toBe(
      "taken",
    );
  });

  it("puts their own booking ahead of every other answer", () => {
    /**
     * The ordering that matters: somebody who booked the last slot of the day
     * and came back to the link must be shown their appointment, not told the
     * offer lapsed — and not told somebody else took the slot they are holding.
     */
    const theirs = invite({ status: "booked" });
    const afterwards = new Date("2026-09-01T00:00:00Z");

    expect(inviteStateFor(theirs, { ...live, slotTaken: true }, NOW)).toBe(
      "booked",
    );
    expect(inviteStateFor(theirs, live, afterwards)).toBe("booked");
  });

  it("expires once the slot has passed", () => {
    expect(
      inviteStateFor(invite(), live, new Date("2026-09-01T00:00:00Z")),
    ).toBe("expired");
  });

  it("expires a withdrawn offer, a closed shop and a missing slot", () => {
    expect(inviteStateFor(invite({ status: "cancelled" }), live, NOW)).toBe(
      "expired",
    );
    expect(inviteStateFor(invite({ status: "expired" }), live, NOW)).toBe(
      "expired",
    );
    expect(
      inviteStateFor(invite(), { ...live, businessIsActive: false }, NOW),
    ).toBe("expired");
    expect(inviteStateFor(invite({ invitedStartsAt: null }), live, NOW)).toBe(
      "expired",
    );
  });
});

describe("offerDeadline", () => {
  const invitedAt = new Date("2026-08-01T09:00:00Z");
  const distantSlot = new Date("2026-08-04T10:00:00Z");

  it("is the shop's window when the slot is far enough away", () => {
    expect(
      offerDeadline({ invitedAt, invitedStartsAt: distantSlot }, 60),
    ).toEqual(new Date("2026-08-01T10:00:00Z"));
  });

  it("is the slot's own start when that comes first", () => {
    /**
     * The case the whole `min` exists for. A sixty-minute window on a slot
     * forty minutes out would otherwise keep an offer alive past the
     * appointment it describes, and the twenty minutes that were left would go
     * to nobody.
     */
    const soon = new Date("2026-08-01T09:40:00Z");

    expect(offerDeadline({ invitedAt, invitedStartsAt: soon }, 60)).toEqual(
      soon,
    );
  });

  it("falls back to the slot start when the window is switched off", () => {
    expect(
      offerDeadline({ invitedAt, invitedStartsAt: distantSlot }, 0),
    ).toEqual(distantSlot);
  });

  it("treats a missing invitedAt as no window rather than as lapsed", () => {
    // "Unknown" must never resolve to "expired": a row that somehow lost its
    // stamp would otherwise have its offer withdrawn by the next sweep.
    expect(
      offerDeadline({ invitedAt: null, invitedStartsAt: distantSlot }, 60),
    ).toEqual(distantSlot);
  });

  it("has nothing to expire when no slot was ever offered", () => {
    expect(offerDeadline({ invitedAt, invitedStartsAt: null }, 60)).toBeNull();
  });
});

describe("offerHasLapsed", () => {
  const invitedAt = new Date("2026-08-01T09:00:00Z");
  const slot = new Date("2026-08-04T10:00:00Z");
  const offer = { invitedAt, invitedStartsAt: slot };

  it("holds the offer right up to the deadline", () => {
    expect(offerHasLapsed(offer, 60, new Date("2026-08-01T09:59:59Z"))).toBe(
      false,
    );
  });

  it("lapses exactly on it", () => {
    // Inclusive, so an offer is never live at the instant it was promised to
    // end — the boundary belongs to the queue, not to the invited client.
    expect(offerHasLapsed(offer, 60, new Date("2026-08-01T10:00:00Z"))).toBe(
      true,
    );
  });

  it("never lapses an entry that holds no offer", () => {
    expect(offerHasLapsed({ invitedAt, invitedStartsAt: null }, 60, slot)).toBe(
      false,
    );
  });
});

describe("inviteStateFor, with a window", () => {
  const invitedAt = new Date("2026-08-01T09:00:00Z");
  const slot = new Date("2026-08-04T10:00:00Z");
  const open = { businessIsActive: true, slotTaken: false, offerTtlMin: 60 };
  const offered = {
    status: "notified",
    invitedAt,
    invitedStartsAt: slot,
    invitedEndsAt: slot,
  };

  it("is open inside the window", () => {
    expect(
      inviteStateFor(offered, open, new Date("2026-08-01T09:30:00Z")),
    ).toBe("open");
  });

  it("expires once the window has passed, before any sweep has run", () => {
    /**
     * The row still says `notified` here — this is the gap between the
     * deadline and the cron noticing it, which is up to fifteen minutes. The
     * page has to answer from the clock, or a link keeps working after the
     * moment its own message promised it would stop.
     */
    expect(
      inviteStateFor(offered, open, new Date("2026-08-01T10:00:01Z")),
    ).toBe("expired");
  });

  it("still shows a booking made inside the window after it closes", () => {
    // `booked` outranks the deadline for the same reason it outranks the slot
    // having passed: somebody returning to a link they already used is not
    // late, and must see their appointment rather than a lapse notice.
    expect(
      inviteStateFor(
        { ...offered, status: "booked" },
        open,
        new Date("2026-08-01T23:00:00Z"),
      ),
    ).toBe("booked");
  });
});
