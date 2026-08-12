import { z } from "zod";

/** Strips separators and rewrites +972 / 00972 to a local 0 prefix. */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  // "+972…" loses its plus to the strip above; "00972…" keeps its trunk code.
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("972")) return `0${digits.slice(3)}`;
  return digits;
}

const ISRAELI_MOBILE = /^05\d{8}$/;

export function isValidPhone(raw: string): boolean {
  return ISRAELI_MOBILE.test(normalizePhone(raw));
}

/** What the client types in step 3. Kept separate from the server payload. */
export const clientDetailsSchema = z.object({
  clientName: z
    .string()
    .trim()
    .min(2, "יש להזין שם מלא")
    .max(80, "השם ארוך מדי"),
  clientPhone: z
    .string()
    .trim()
    .min(1, "יש להזין מספר טלפון")
    // Validated, not transformed: the server normalises before storing, so the
    // field keeps whatever the user typed while they are editing it.
    .refine(isValidPhone, "מספר טלפון נייד לא תקין (לדוגמה: 050-1234567)"),
  // Optional, but it is the only channel confirmations and reminders use.
  clientEmail: z
    .union([z.email("כתובת אימייל לא תקינה"), z.literal("")])
    .optional(),
  notes: z.string().trim().max(500, "ההערה ארוכה מדי").optional(),
  /**
   * Honeypot. Visually hidden and excluded from the tab order, so a human
   * cannot fill it — anything here means a script. Deliberately permissive:
   * the value is inspected by the server, never rejected by validation, so
   * the bot sees a normal success.
   */
  contactReference: z.string().max(200).optional(),
  /** Milliseconds between form mount and submit. Client-supplied, so weak. */
  elapsedMs: z.number().int().nonnegative().optional(),
  /**
   * Consent to marketing messages — currently only the win-back (0021).
   *
   * **Optional here, and narrowed to `=== true` where it is stored.** Absence
   * must read as "did not agree", never as "did not object": a payload without
   * it came from a form that never showed the box, and inferring consent from
   * silence is exactly what סעיף 30א forbids. An unticked checkbox submits
   * nothing at all, so absence is the common path rather than an edge case.
   *
   * Deliberately not `.default(false)`: that makes the parsed type
   * non-optional while the input type stays optional, which react-hook-form's
   * resolver rejects — and the `=== true` at the call site is the stricter
   * check anyway.
   */
  consentMarketing: z.boolean().optional(),
});

/** A human takes longer than this to read a summary and type name + phone. */
export const MIN_HUMAN_FILL_MS = 2500;

/**
 * True when a submission looks automated. The honeypot is the reliable signal;
 * the timing check is defence-in-depth only, since the client supplies it.
 */
export function looksAutomated(input: {
  contactReference?: string;
  elapsedMs?: number;
}): { automated: boolean; reason?: string } {
  if (input.contactReference && input.contactReference.trim().length > 0) {
    return { automated: true, reason: "honeypot filled" };
  }

  if (
    typeof input.elapsedMs === "number" &&
    input.elapsedMs < MIN_HUMAN_FILL_MS
  ) {
    return { automated: true, reason: `submitted in ${input.elapsedMs}ms` };
  }

  return { automated: false };
}

export type ClientDetails = z.infer<typeof clientDetailsSchema>;

/** Full payload the booking server action accepts. Never trust any of it. */
export const bookingInputSchema = clientDetailsSchema.extend({
  /**
   * The public page slug, not a business id. The server resolves the business
   * from this itself, so the browser never gets to nominate which tenant a
   * booking lands in — matching how the slot lookup already works.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "כתובת העסק חסרה")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "כתובת עסק לא תקינה"),
  serviceId: z.uuid("מזהה שירות לא תקין"),
  startsAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "מועד לא תקין"),
  /**
   * Who the client picked at step 3. Optional, and treated as a *preference*
   * rather than an instruction: the server re-derives who is actually free at
   * the chosen time and refuses a choice that is not among them. A single-staff
   * tenant never sends it, and the server resolves the only provider itself.
   */
  staffId: z.uuid("מזהה נותן שירות לא תקין").optional(),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;
