import { describe, expect, it } from "vitest";

import {
  authIdentifier,
  PASSWORD_RULES,
  passwordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth-validation";

const ok = (password: string) => passwordSchema.safeParse(password).success;

describe("password strength", () => {
  it("accepts a password with length, a letter and a digit", () => {
    expect(ok("bazman12")).toBe(true);
    expect(ok("correcthorse9")).toBe(true);
  });

  it("accepts Hebrew letters", () => {
    // The audience types Hebrew. Rejecting a Hebrew passphrase while accepting
    // `abc12345` would be both hostile and wrong.
    expect(ok("סיסמה1234")).toBe(true);
  });

  it("rejects anything under the minimum length", () => {
    expect(ok("abc123")).toBe(false);
  });

  it("rejects digits alone and letters alone", () => {
    expect(ok("123456789")).toBe(false);
    expect(ok("abcdefghij")).toBe(false);
  });

  it("rejects a password long enough to be a hashing hazard", () => {
    // bcrypt silently truncates past 72 bytes, so a longer value would give a
    // false sense of strength.
    expect(ok(`a1${"x".repeat(80)}`)).toBe(false);
  });

  it("names the failing rule rather than rejecting generically", () => {
    const result = passwordSchema.safeParse("abcdefgh");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("ספרה");
    }
  });
});

describe("PASSWORD_RULES", () => {
  it("agrees with the schema on every rule it displays", () => {
    // The hint a reader sees and the rule the server enforces must not drift:
    // a UI that ticks every box on a password the server then rejects is worse
    // than no hint at all.
    const passing = "bazman12";
    expect(PASSWORD_RULES.every((rule) => rule.test(passing))).toBe(true);
    expect(ok(passing)).toBe(true);

    for (const failing of ["abcdefgh", "12345678", "ab1"]) {
      expect(PASSWORD_RULES.every((rule) => rule.test(failing))).toBe(false);
      expect(ok(failing)).toBe(false);
    }
  });
});

describe("signInSchema", () => {
  it("does not apply the strength rules", () => {
    // Enforcing them on sign-in would lock out anyone who registered before
    // the policy existed, and leaks the policy to someone who has not guessed
    // a valid password.
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "old" }).success,
    ).toBe(true);
  });

  it("still requires a password and a valid address", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.co", password: "" }).success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({ email: "nope", password: "whatever" }).success,
    ).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("applies the strength rules", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.co", password: "abcdefgh" }).success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ email: "a@b.co", password: "abcdefg1" }).success,
    ).toBe(true);
  });
});

describe("authIdentifier", () => {
  it("is stable and case-insensitive, so the counter cannot be dodged", () => {
    expect(authIdentifier("Owner@Example.com")).toBe(
      authIdentifier(" owner@example.com "),
    );
  });

  it("differs between addresses", () => {
    expect(authIdentifier("a@example.com")).not.toBe(
      authIdentifier("b@example.com"),
    );
  });

  it("never returns the address itself", () => {
    // The rate-limit table would otherwise become a list of everyone who ever
    // mistyped a password: a list worth stealing, created as a side effect of
    // defending against theft.
    const id = authIdentifier("owner@example.com");
    expect(id).not.toContain("owner");
    expect(id).not.toContain("@");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
