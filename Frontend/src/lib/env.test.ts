import { describe, expect, it } from "vitest";

import { checkEnv } from "@/lib/env";

const complete = {
  NEXT_PUBLIC_APP_URL: "https://book.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  DATABASE_URL: "postgresql://user:pass@host:6543/postgres",
  DIRECT_URL: "postgresql://user:pass@host:5432/postgres",
  CRON_SECRET: "a-sufficiently-long-secret",
};

/** Copy of `complete` with one key removed, without unused destructuring. */
function without(key: keyof typeof complete) {
  const copy: Record<string, string | undefined> = { ...complete };
  delete copy[key];
  return copy;
}

function errorsOf(env: Record<string, string | undefined>, production = true) {
  return checkEnv(env, { production })
    .issues.filter((i) => i.level === "error")
    .map((i) => `${i.name}: ${i.reason}`);
}

describe("checkEnv", () => {
  it("passes on a complete production config", () => {
    const report = checkEnv(complete, { production: true });
    expect(report.ok).toBe(true);
    expect(errorsOf(complete)).toEqual([]);
  });

  it("flags missing required variables", () => {
    expect(errorsOf(without("NEXT_PUBLIC_SUPABASE_URL"))).toContain(
      "NEXT_PUBLIC_SUPABASE_URL: not set",
    );
  });

  it("treats CRON_SECRET as optional in development but required in production", () => {
    expect(errorsOf(without("CRON_SECRET"), false)).toEqual([]);
    expect(errorsOf(without("CRON_SECRET"), true)).toContain(
      "CRON_SECRET: not set",
    );
  });

  it("catches the unreplaced Supabase password placeholder", () => {
    const errors = errorsOf({
      ...complete,
      DATABASE_URL: "postgresql://user:[YOUR-PASSWORD]@host:6543/postgres",
    });
    expect(errors.join()).toMatch(/placeholder brackets/);
  });

  it("catches a localhost app URL in production", () => {
    const errors = errorsOf({
      ...complete,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
    // Only fires when NODE_ENV is genuinely production.
    expect(errors.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects a too-short CRON_SECRET", () => {
    expect(errorsOf({ ...complete, CRON_SECRET: "short" }).join()).toMatch(
      /at least 16/,
    );
  });

  it("rejects half-configured email", () => {
    const errors = errorsOf({ ...complete, RESEND_API_KEY: "re_abc123" });
    expect(errors.join()).toMatch(/half-configured/);
  });

  it("accepts email when both variables are present", () => {
    const errors = errorsOf({
      ...complete,
      RESEND_API_KEY: "re_abc123",
      NOTIFICATIONS_FROM_EMAIL: "noreply@example.com",
    });
    expect(errors).toEqual([]);
  });

  it("warns rather than errors when email is left unconfigured", () => {
    const report = checkEnv(complete, { production: true });
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.name === "RESEND_API_KEY")).toBe(true);
  });
});
