import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Credential rules, shared by the server actions and the sign-up form so the
 * hint a reader sees and the rule the server enforces cannot drift.
 */

export const emailSchema = z.email("כתובת אימייל לא תקינה");

/**
 * Sign-up strength. Length carries most of the value, so the character classes
 * are deliberately mild: a rule that demands symbols and mixed case mostly
 * produces `Password1!` and a sticky note, which is weaker in practice than a
 * longer passphrase.
 *
 * Hebrew letters count. The audience types Hebrew, and rejecting a Hebrew
 * passphrase while accepting `abc12345` would be both hostile and wrong.
 */
export const PASSWORD_MIN = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `הסיסמה חייבת להכיל לפחות ${PASSWORD_MIN} תווים`)
  .max(72, "הסיסמה ארוכה מדי")
  .regex(/[A-Za-z֐-׿]/, "הסיסמה חייבת להכיל לפחות אות אחת")
  .regex(/\d/, "הסיסמה חייבת להכיל לפחות ספרה אחת");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Sign-in deliberately does **not** apply the strength rules.
 *
 * Enforcing them here would lock out anyone who registered before the policy
 * existed, and it leaks the policy to an attacker who has not guessed a valid
 * password yet. Length is checked only to avoid a pointless round trip.
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "יש להזין סיסמה").max(72),
});

/** A reset request needs nothing but an address. */
export const resetRequestSchema = z.object({ email: emailSchema });

/**
 * Choosing a replacement password, so the **strength rules apply** — this is
 * the sign-up case, not the sign-in one. The confirmation field is validated
 * here rather than in the component so the rule survives a form rewrite: a
 * mistyped new password on an account whose old one is already forgotten
 * locks the owner out of the very flow they came to use.
 */
export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "הסיסמאות אינן תואמות",
  });

/** The checks a UI hint can render, in the order they are listed to a reader. */
export const PASSWORD_RULES = [
  {
    id: "length",
    label: `לפחות ${PASSWORD_MIN} תווים`,
    test: (value: string) => value.length >= PASSWORD_MIN,
  },
  {
    id: "letter",
    label: "לפחות אות אחת",
    test: (value: string) => /[A-Za-z֐-׿]/.test(value),
  },
  {
    id: "digit",
    label: "לפחות ספרה אחת",
    test: (value: string) => /\d/.test(value),
  },
] as const;

/**
 * Stable, non-reversible key for per-identity rate limiting.
 *
 * The rate-limit table would otherwise accumulate plaintext email addresses of
 * everyone who ever mistyped a password — a list worth stealing, created as a
 * side effect of defending against theft. Hashing keeps the counter working
 * and makes the row worthless.
 */
export function authIdentifier(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}
