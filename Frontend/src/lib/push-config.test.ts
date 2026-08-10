import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ensureConfigured` used to fall back to a hard-coded `mailto:` address when
 * `VAPID_SUBJECT` was unset, which is the wrong shape of guess: the `sub` claim
 * is how a push service reaches **the operator** when a deployment misbehaves
 * (RFC 8292 §2.1), the domain in that constant need not belong to whoever
 * deployed this, and it made a missing variable invisible — the first sign of
 * trouble would have been a push service quietly dropping traffic.
 *
 * These drive the module through `process.env`, so they need a fresh import per
 * case: the configured flag is cached for the life of the process on purpose.
 */

/**
 * A genuine P-256 pair, generated once for this file and used nowhere else.
 * `setVapidDetails` validates the curve point, so an invented string would
 * throw on the *keys* and every case below would pass for the wrong reason —
 * proving only that a broken key is rejected, never that the subject rule runs.
 */
const KEYS = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    "BLH44ZtC6ChZCAUQiuXYe7Mop_5xZLloh-eBEviiYGP7YSx21qCmD_9Fm9sIDLfMBrijHj_vOmowpb8O6OJBs9g",
  VAPID_PRIVATE_KEY: "hGety2pGkjPhIOyamb1CRrzFSr_PoWBEKePqeqWGgNE",
};

async function loadPush(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./push");
}

const original = { ...process.env };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

describe("web push configuration", () => {
  it("is configured when all three variables are valid", async () => {
    const push = await loadPush({
      ...KEYS,
      VAPID_SUBJECT: "mailto:support@example.com",
    });

    expect(push.isPushConfigured()).toBe(true);
  });

  it("refuses rather than inventing a subject when it is unset", async () => {
    const push = await loadPush({ ...KEYS, VAPID_SUBJECT: undefined });

    expect(push.isPushConfigured()).toBe(false);
  });

  it("refuses the placeholder from .env.example", async () => {
    // Structurally a perfectly good mailto:, which is exactly why it needs
    // naming: nothing else would catch it.
    const push = await loadPush({
      ...KEYS,
      VAPID_SUBJECT: "mailto:you@yourdomain.com",
    });

    expect(push.isPushConfigured()).toBe(false);
  });

  it.each(["support@example.com", "http://example.com", "Bazman support"])(
    "refuses %s, which is not an RFC 8292 subject",
    async (subject) => {
      const push = await loadPush({ ...KEYS, VAPID_SUBJECT: subject });
      expect(push.isPushConfigured()).toBe(false);
    },
  );

  it("stays unconfigured when the keys are absent", async () => {
    const push = await loadPush({
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
      VAPID_SUBJECT: "mailto:support@example.com",
    });

    expect(push.isPushConfigured()).toBe(false);
  });

  it("reports the reason rather than failing silently", async () => {
    const push = await loadPush({ ...KEYS, VAPID_SUBJECT: "nonsense" });
    push.isPushConfigured();

    // A misconfiguration nobody can see is the failure mode being fixed here,
    // so the log line is part of the contract.
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toMatch(/push.configure/);
    expect(logged).toMatch(/VAPID_SUBJECT/);
  });

  it("agrees with what check:env reports", async () => {
    // Two copies of "is push usable" would let a green deploy check coexist
    // with a runtime that refuses — the exact thing check:env exists to stop.
    const { checkEnv } = await import("./env");

    for (const subject of [
      "mailto:support@example.com",
      "mailto:you@yourdomain.com",
      "support@example.com",
    ]) {
      const env = { ...KEYS, VAPID_SUBJECT: subject };
      const push = await loadPush(env);

      expect(push.isPushConfigured()).toBe(
        checkEnv(env as Record<string, string>, {}).pushLive,
      );
    }
  });
});
