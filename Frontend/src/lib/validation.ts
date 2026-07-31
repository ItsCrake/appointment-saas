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
  notes: z.string().trim().max(500, "ההערה ארוכה מדי").optional(),
});

export type ClientDetails = z.infer<typeof clientDetailsSchema>;

/** Full payload the booking server action accepts. Never trust any of it. */
export const bookingInputSchema = clientDetailsSchema.extend({
  businessId: z.uuid("מזהה עסק לא תקין"),
  serviceId: z.uuid("מזהה שירות לא תקין"),
  startsAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "מועד לא תקין"),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;
