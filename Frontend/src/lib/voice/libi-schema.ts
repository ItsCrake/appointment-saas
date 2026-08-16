import { z } from "zod";

/**
 * Libi — the Hebrew voice assistant's data contract and its pure logic.
 *
 * ---------------------------------------------------------------------------
 * Everything in this file is **pure**: no IO, no database handle, no SDK. The
 * model call lives in `libi.ts` and the action in `dashboard/voice-actions.ts`,
 * for the same reason `entitlements.ts` and `lifecycle.ts` are split from their
 * callers — the rules that decide what a transcript *means* are the part worth
 * unit-testing, and they must not need an API key to run.
 * ---------------------------------------------------------------------------
 */

/**
 * What Libi is allowed to return. This is the schema handed to the model as a
 * structured output, so it is the same object in three places at once: the
 * model's grammar, the server's validator, and the client's type.
 *
 * Every extracted field is nullable **on purpose**. A voice command is a
 * sentence a human said once, into a phone, in a busy shop — partial extraction
 * is the normal case, not the error case, and the flow is built to ask for the
 * rest rather than to reject the utterance.
 */
export const libiExtractionSchema = z.object({
  /** As spoken. Never invented — a booking under a guessed name is worse than none. */
  clientName: z.string().nullable(),
  /** Israeli mobile, digits only or dashed. Rarely present; see `missingFields`. */
  clientPhone: z.string().nullable(),
  /**
   * The **exact** `id` of one of the services offered in the prompt, or null.
   *
   * Never a free-text service name: the appointment stores a real `service_id`
   * with a restrict-on-delete FK, and a hallucinated uuid would fail the insert
   * at best and match the wrong service at worst. Matching happens in the model
   * against a list we supply, and is re-checked server-side against the tenant's
   * own catalogue before anything is written.
   */
  serviceId: z.string().nullable(),
  /**
   * Local wall-clock start, `YYYY-MM-DDTHH:mm`, in the business timezone.
   *
   * **Deliberately not an ISO instant with an offset.** The rest of this
   * product resolves wall-clock input through `fromZonedTime(…, timezone)` at
   * the boundary, and asking a language model to do timezone arithmetic — over
   * a DST boundary, in a zone it has to infer — is asking it to be wrong twice
   * a year in a way nobody would notice until someone missed an appointment.
   * It reports what the owner said; the server decides what instant that is.
   */
  startLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  notes: z.string().nullable(),
  /**
   * How sure Libi is that she understood the *utterance* — not whether the
   * booking is complete, which `missingFields` answers. Low confidence on a
   * complete extraction still stops and confirms, because Hebrew STT
   * mis-hearing a name is silent and a booking is not easily undone.
   */
  confidence: z.enum(["high", "medium", "low"]),
  /**
   * What Libi still needs, in the order she should ask for it. Empty means she
   * believes she has everything.
   *
   * The server does not trust this: it recomputes the same list from the fields
   * actually present (see `missingFieldsFor`). The model's copy exists so the
   * Hebrew question it writes agrees with what is genuinely missing.
   */
  missingFields: z.array(
    z.enum(["clientName", "clientPhone", "serviceId", "startLocal"]),
  ),
  /** What Libi says out loud, in Hebrew. Always populated, success or not. */
  feedbackMessage: z.string(),
});

export type LibiExtraction = z.infer<typeof libiExtractionSchema>;

/** The fields a booking cannot be written without. Order is the asking order. */
export const REQUIRED_FIELDS = [
  "serviceId",
  "startLocal",
  "clientName",
  "clientPhone",
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/** Hebrew names for the fields, for the one message the client renders itself. */
export const FIELD_LABELS: Record<RequiredField, string> = {
  serviceId: "שירות",
  startLocal: "מועד",
  clientName: "שם הלקוח",
  clientPhone: "מספר טלפון",
};

/**
 * What is still missing, computed from the fields themselves.
 *
 * The model returns its own `missingFields`, and this deliberately ignores it.
 * A model that believes it has a phone number when the field is null would
 * otherwise drive the flow into a booking that cannot be inserted — the same
 * class of mistake as trusting `plan_type` without `subscription_status`.
 */
export function missingFieldsFor(
  draft: Partial<Record<RequiredField, string | null>>,
): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => {
    const value = draft[field];
    return typeof value !== "string" || value.trim() === "";
  });
}

/**
 * Merge a fresh extraction over what Libi already had.
 *
 * Clarification is multi-turn: "תוסיפי תור לדני מחר בעשר" then "לתספורת" then
 * "050-1234567". Each utterance is parsed with the previous draft in context,
 * so the model can also *correct* an earlier field — "לא, בשתיים" has to be
 * able to overwrite `startLocal`.
 *
 * **A null never overwrites a value.** The second utterance mentions only the
 * service, so every other field comes back null; treating that as a retraction
 * would make the flow unable to ever finish. The model can only add or replace,
 * never clear — which is the right asymmetry, because forgetting is not
 * something a user asks for by saying a sentence about something else.
 */
export function mergeDraft(
  previous: LibiDraft,
  next: Partial<LibiDraft>,
): LibiDraft {
  const pick = (a: string | null | undefined, b: string | null) =>
    typeof a === "string" && a.trim() !== "" ? a : b;

  return {
    clientName: pick(next.clientName, previous.clientName),
    clientPhone: pick(next.clientPhone, previous.clientPhone),
    serviceId: pick(next.serviceId, previous.serviceId),
    startLocal: pick(next.startLocal, previous.startLocal),
    notes: pick(next.notes, previous.notes),
  };
}

/** The accumulated booking Libi is building across one conversation. */
export type LibiDraft = {
  clientName: string | null;
  clientPhone: string | null;
  serviceId: string | null;
  startLocal: string | null;
  notes: string | null;
};

export const EMPTY_DRAFT: LibiDraft = {
  clientName: null,
  clientPhone: null,
  serviceId: null,
  startLocal: null,
  notes: null,
};

/** Splits a validated local wall-clock string into the action's two fields. */
export function splitLocal(startLocal: string): { date: string; time: string } {
  const [date, time] = startLocal.split("T");
  return { date, time };
}

/**
 * The Hebrew question Libi asks for the first missing field.
 *
 * Used only when the model's own `feedbackMessage` cannot be trusted — a
 * refusal, a transport failure, or a reply whose `missingFields` disagreed with
 * the fields it actually returned. In the ordinary case Libi's own sentence is
 * better, because it can refer to what she already has ("ולאיזה שירות עבור
 * דני?"). This is the floor, not the intent.
 */
export function fallbackPrompt(missing: readonly RequiredField[]): string {
  if (missing.length === 0) return "הבנתי. קובעת את התור…";
  return `מה ${FIELD_LABELS[missing[0]]}?`;
}
