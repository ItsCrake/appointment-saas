import type { DraftAction, PendingAction } from "./libi-tools";

/**
 * What the browser carries from one turn to the next, shape-checked on the way
 * back in.
 *
 * ---------------------------------------------------------------------------
 * **Form fields, so they can be anything.** The endpoint holds no session
 * state, so the question ליבי asked last turn — a yes/no about a change, or a
 * request for one more detail — rides back with the next recording. These
 * checks are only enough to hand `decide` something of the right type. The
 * *authority* checks are elsewhere and do not trust any of it: `executePending`
 * and `confirmSwap` re-read every row under the signed-in tenant, and every id
 * in a draft is re-resolved against this shop's own lists before it is used.
 *
 * **Malformed is absent, never repaired.** A half-parsed pending action is a
 * yes to something nobody asked.
 *
 * Moved out of the route so the shapes can be tested — they grew a third
 * pending kind and a second carried value, and a route file is not somewhere a
 * test can reach.
 * ---------------------------------------------------------------------------
 */

type Fields = Record<string, unknown>;

function parseObject(raw: unknown): Fields | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Fields)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The longest free text a carried value may hold — a name, a service. */
const MAX_TEXT = 120;

const text = (value: Fields, key: string) =>
  typeof value[key] === "string" && (value[key] as string).length <= MAX_TEXT;

const optionalText = (value: Fields, key: string) =>
  value[key] === undefined || text(value, key);

function swapLeg(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const leg = raw as Fields;
  return (
    text(leg, "appointmentId") &&
    text(leg, "clientName") &&
    text(leg, "when") &&
    text(leg, "toWhen") &&
    text(leg, "startsAtIso") &&
    text(leg, "targetStartsAtIso")
  );
}

/**
 * The pending action the previous turn returned, as the client sent it back.
 */
export function parsePending(raw: unknown): PendingAction | undefined {
  const value = parseObject(raw);
  if (!value) return undefined;

  if (value.kind === "swap") {
    return swapLeg(value.first) && swapLeg(value.second)
      ? (value as unknown as PendingAction)
      : undefined;
  }

  const shared =
    text(value, "appointmentId") &&
    text(value, "clientName") &&
    text(value, "when") &&
    text(value, "startsAtIso");

  if (!shared) return undefined;
  if (value.kind === "cancel") return value as unknown as PendingAction;

  return value.kind === "reschedule" &&
    text(value, "toWhen") &&
    text(value, "targetStartsAtIso")
    ? (value as unknown as PendingAction)
    : undefined;
}

const AWAITING = ["time", "service", "staff"] as const;

/**
 * The half-finished change the previous turn returned — see `DraftAction`.
 */
export function parseDraft(raw: unknown): DraftAction | undefined {
  const value = parseObject(raw);
  if (!value) return undefined;

  if (value.kind === "move") {
    return text(value, "appointmentId") &&
      text(value, "clientName") &&
      text(value, "when") &&
      text(value, "startsAtIso") &&
      optionalText(value, "date")
      ? (value as unknown as DraftAction)
      : undefined;
  }

  if (value.kind !== "book") return undefined;

  const shaped =
    AWAITING.includes(value.awaiting as (typeof AWAITING)[number]) &&
    text(value, "date") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date as string) &&
    ["name", "time", "phone", "serviceId", "service", "staffId", "staff"].every(
      (key) => optionalText(value, key),
    );

  return shaped ? (value as unknown as DraftAction) : undefined;
}

/**
 * The question a carried value was asked with, for a turn that has no history
 * to read it from.
 *
 * The history's last reply is the exact sentence ליבי spoke and is preferred;
 * this is the fallback the transcriber gets as context — "כן" is a hard word
 * to hear in a loud room and an easy one after "לבטל אותו?".
 */
export function carriedQuestion(
  pending: PendingAction | undefined,
  draft: DraftAction | undefined,
): string | null {
  if (pending?.kind === "cancel") {
    return `לבטל את התור של ${pending.clientName} ב-${pending.when}?`;
  }
  if (pending?.kind === "reschedule") {
    return `להזיז את ${pending.clientName} מ-${pending.when} ל-${pending.toWhen}?`;
  }
  if (pending?.kind === "swap") {
    return `להחליף בין ${pending.first.clientName} ל${pending.second.clientName}?`;
  }
  if (draft?.kind === "move") {
    return `לאיזו שעה או לאיזה יום להזיז את התור של ${draft.clientName}?`;
  }
  if (draft?.kind === "book") {
    return draft.awaiting === "time"
      ? "לאיזו שעה לקבוע?"
      : draft.awaiting === "service"
        ? "איזה שירות?"
        : "אצל מי?";
  }
  return null;
}
