import { describe, expect, it } from "vitest";

import type { Slot } from "@/lib/availability";
import { groupSlotsByPeriod, slotPeriod } from "@/lib/slot-periods";

const slot = (label: string): Slot => ({
  startsAt: `2026-09-06T${label}:00.000Z`,
  endsAt: `2026-09-06T${label}:00.000Z`,
  label,
});

describe("slotPeriod", () => {
  it("splits the day at 12:00 and 17:00", () => {
    expect(slotPeriod("00:00")).toBe("morning");
    expect(slotPeriod("11:59")).toBe("morning");
    expect(slotPeriod("12:00")).toBe("afternoon");
    expect(slotPeriod("16:59")).toBe("afternoon");
    expect(slotPeriod("17:00")).toBe("evening");
    expect(slotPeriod("23:45")).toBe("evening");
  });

  it("keeps a malformed label visible rather than dropping it", () => {
    expect(slotPeriod("")).toBe("morning");
    expect(slotPeriod("--:--")).toBe("morning");
  });
});

describe("groupSlotsByPeriod", () => {
  it("returns groups in chronological order", () => {
    const groups = groupSlotsByPeriod([
      slot("18:00"),
      slot("09:00"),
      slot("13:30"),
    ]);

    expect(groups.map((g) => g.period)).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
  });

  it("preserves slot order within a group", () => {
    const groups = groupSlotsByPeriod([
      slot("09:00"),
      slot("09:30"),
      slot("10:00"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].slots.map((s) => s.label)).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("omits periods with no slots", () => {
    // An evening-only shop must not render an empty "morning" heading.
    const groups = groupSlotsByPeriod([slot("19:00"), slot("20:00")]);

    expect(groups).toHaveLength(1);
    expect(groups[0].period).toBe("evening");
    expect(groups[0].slots).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(groupSlotsByPeriod([])).toEqual([]);
  });

  it("keeps every slot — nothing is lost in grouping", () => {
    const labels = ["08:00", "11:59", "12:00", "16:59", "17:00", "22:15"];
    const groups = groupSlotsByPeriod(labels.map(slot));

    expect(groups.flatMap((g) => g.slots.map((s) => s.label))).toEqual(labels);
  });
});
