import type { Slot } from "./availability";

export type SlotPeriod = "morning" | "afternoon" | "evening";

/**
 * Boundaries read off `slot.label` ("HH:mm"), which the availability engine
 * already rendered in the business timezone. Grouping therefore needs no
 * timezone maths of its own and cannot disagree with the time on the button.
 */
const AFTERNOON_FROM = 12;
const EVENING_FROM = 17;

export function slotPeriod(label: string): SlotPeriod {
  const hour = Number.parseInt(label.slice(0, 2), 10);
  // A malformed label should still render somewhere rather than vanish.
  if (!Number.isFinite(hour)) return "morning";
  if (hour >= EVENING_FROM) return "evening";
  if (hour >= AFTERNOON_FROM) return "afternoon";
  return "morning";
}

export type SlotGroup<T extends Slot = Slot> = {
  period: SlotPeriod;
  slots: T[];
};

const ORDER = ["morning", "afternoon", "evening"] as const;

/**
 * Chronological, and **non-empty groups only** — a shop that never opens in the
 * morning should not show an empty "morning" heading.
 */
export function groupSlotsByPeriod<T extends Slot>(slots: T[]): SlotGroup<T>[] {
  // Generic so a slot carrying more than the base shape — the staff free at it,
  // for instance — keeps that information through the grouping.
  const buckets = new Map<SlotPeriod, T[]>();

  for (const slot of slots) {
    const period = slotPeriod(slot.label);
    const bucket = buckets.get(period);
    if (bucket) bucket.push(slot);
    else buckets.set(period, [slot]);
  }

  return ORDER.flatMap((period) => {
    const found = buckets.get(period);
    return found ? [{ period, slots: found }] : [];
  });
}
