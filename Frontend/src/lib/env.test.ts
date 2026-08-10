import { describe, expect, it } from "vitest";

import { checkEnv } from "@/lib/env";

const complete = {
  NEXT_PUBLIC_APP_URL: "https://book.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  // Production-required since owner image uploads started using it to sign
  // upload URLs — without it the upload controls refuse on three screens.
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DATABASE_URL: "postgresql://user:pass@host:6543/postgres",
  DIRECT_URL: "postgresql://user:pass@host:5432/postgres",
  CRON_SECRET: "a-sufficiently-long-secret",
  RESEND_API_KEY: "re_abc123",
  NOTIFICATIONS_FROM_EMAIL: "noreply@example.com",
  // Production-required since the Pro tier sells SMS reminders.
  TWILIO_ACCOUNT_SID: "AC0123456789",
  TWILIO_AUTH_TOKEN: "twilio-auth-token",
  TWILIO_SMS_FROM: "+972500000000",
};

/** Copy of `complete` with keys removed, without unused destructuring. */
function without(...keys: (keyof typeof complete)[]) {
  const copy: Record<string, string | undefined> = { ...complete };
  for (const key of keys) delete copy[key];
  return copy;
}

const noEmail = () => without("RESEND_API_KEY", "NOTIFICATIONS_FROM_EMAIL");

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

  it("blocks a production deploy where owners cannot upload an image", () => {
    // The dashboard renders an upload control on settings, staff and
    // appearance. Without the service-role key every one of them refuses at
    // the moment a file is picked — visibly broken rather than silently, but
    // still not a state to launch in.
    expect(errorsOf(without("SUPABASE_SERVICE_ROLE_KEY"), true)).toContain(
      "SUPABASE_SERVICE_ROLE_KEY: not set",
    );
    // Locally it is only a warning: the URL fields still work without it.
    expect(errorsOf(without("SUPABASE_SERVICE_ROLE_KEY"), false)).toEqual([]);
  });

  it("blocks a production deploy that cannot send the SMS the Pro tier sells", () => {
    // Twilio is not merely "nice to have" once a tier advertises SMS
    // reminders: an unconfigured channel falls back to the console provider
    // and reports success, so this is the check standing between a paying Pro
    // tenant and reminders that quietly go nowhere.
    expect(errorsOf(without("TWILIO_SMS_FROM"), true)).toContain(
      "TWILIO_SMS_FROM: not set",
    );
    // Still only a warning locally — the console provider is the point in dev.
    expect(errorsOf(without("TWILIO_SMS_FROM"), false)).toEqual([]);
  });

  it("keeps WhatsApp optional — reminders are never auto-routed to it", () => {
    expect(errorsOf(without(), true)).toEqual([]);
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

  it("keeps a malformed production variable advisory in development", () => {
    // A missing CRON_SECRET is only a warning in dev, so a short one must be
    // too — otherwise severity depends on the shape of the problem.
    expect(errorsOf({ ...complete, CRON_SECRET: "short" }, false)).toEqual([]);
  });

  describe("email delivery", () => {
    it("requires the email provider in production but not in development", () => {
      expect(errorsOf(noEmail(), true)).toEqual(
        expect.arrayContaining([
          "RESEND_API_KEY: not set",
          "NOTIFICATIONS_FROM_EMAIL: not set",
        ]),
      );
      expect(errorsOf(noEmail(), false)).toEqual([]);
    });

    it("reports which provider the email channel resolves to", () => {
      expect(checkEnv(complete, { production: true }).emailChannel).toBe(
        "resend",
      );
      expect(checkEnv(noEmail(), { production: false }).emailChannel).toBe(
        "console",
      );
    });

    it("resolves to console whenever either variable is missing", () => {
      expect(
        checkEnv(without("RESEND_API_KEY"), { production: false }).emailChannel,
      ).toBe("console");
      expect(
        checkEnv(without("NOTIFICATIONS_FROM_EMAIL"), { production: false })
          .emailChannel,
      ).toBe("console");
    });

    it("rejects half-configured email in either mode", () => {
      expect(
        errorsOf(without("NOTIFICATIONS_FROM_EMAIL"), true).join(),
      ).toMatch(/half-configured/);
      expect(errorsOf(without("RESEND_API_KEY"), false).join()).toMatch(
        /half-configured/,
      );
    });

    it("reports a half-configured variable once, not twice", () => {
      // In production the variable is both "not set" and "half-configured";
      // only the more informative message should survive.
      const issues = checkEnv(without("NOTIFICATIONS_FROM_EMAIL"), {
        production: true,
      }).issues.filter((i) => i.name === "NOTIFICATIONS_FROM_EMAIL");

      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toMatch(/half-configured/);
    });

    it("rejects a key that is not shaped like a Resend key", () => {
      expect(
        errorsOf({ ...complete, RESEND_API_KEY: "sk_live_abc" }).join(),
      ).toMatch(/Resend key/);
    });

    it("rejects a sender without an email address", () => {
      expect(
        errorsOf({ ...complete, NOTIFICATIONS_FROM_EMAIL: "תורים" }).join(),
      ).toMatch(/must contain an email address/);
    });

    it('accepts a "Name <addr>" sender', () => {
      expect(
        errorsOf({
          ...complete,
          NOTIFICATIONS_FROM_EMAIL: "תורים <noreply@example.com>",
        }),
      ).toEqual([]);
    });
  });

  describe("web push", () => {
    const push = {
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BPublicKey",
      VAPID_PRIVATE_KEY: "PrivateKey",
      VAPID_SUBJECT: "mailto:support@example.com",
    };

    it("is a valid state to leave entirely unconfigured", () => {
      // Unlike email, push genuinely can be off: owners still get email alerts
      // and the booking is on the dashboard either way.
      expect(errorsOf(complete, true)).toEqual([]);
      expect(checkEnv(complete, { production: true }).pushLive).toBe(false);
    });

    it("is live only when all three are set and the subject is valid", () => {
      expect(checkEnv({ ...complete, ...push }, {}).pushLive).toBe(true);
    });

    it.each(Object.keys(push))(
      "rejects a config missing only %s, in either mode",
      (missing) => {
        const partial: Record<string, string | undefined> = {
          ...complete,
          ...push,
        };
        delete partial[missing];

        // An error in development too: `push:keys` prints all three lines at
        // once, so two-of-three is a paste that went wrong, never a decision.
        expect(errorsOf(partial, true).join()).toMatch(/half-configured/);
        expect(errorsOf(partial, false).join()).toMatch(/half-configured/);
        expect(checkEnv(partial, {}).pushLive).toBe(false);
      },
    );

    it("names the missing variable once, not twice", () => {
      const issues = checkEnv(
        { ...complete, ...push, VAPID_SUBJECT: undefined },
        { production: true },
      ).issues.filter((i) => i.name === "VAPID_SUBJECT");

      expect(issues).toHaveLength(1);
      expect(issues[0].reason).toMatch(/half-configured/);
    });

    it("rejects the placeholder shipped in .env.example", () => {
      // The single most likely wrong value to reach production, and one that
      // passes every structural test.
      const env = {
        ...complete,
        ...push,
        VAPID_SUBJECT: "mailto:you@yourdomain.com",
      };
      expect(errorsOf(env, true).join()).toMatch(/example value/);
      expect(checkEnv(env, {}).pushLive).toBe(false);
    });

    it.each([
      ["a bare email", "support@example.com"],
      ["an http origin", "http://example.com"],
      ["a mailto without an address", "mailto:support"],
      ["prose", "Bazman support"],
    ])("rejects %s as a subject, even in development", (_label, subject) => {
      // An error rather than a warning *because the keys are set*: push would
      // refuse at runtime while the product still claimed it was configured.
      const env = { ...complete, ...push, VAPID_SUBJECT: subject };
      expect(errorsOf(env, false).join()).toMatch(/cannot configure/);
      expect(checkEnv(env, {}).pushLive).toBe(false);
    });

    it("blames the missing keys, not the subject's format, when only it is set", () => {
      // A subject with no key pair is half-configured, and that is the useful
      // thing to say. Reporting the format as well would send someone off to
      // fix a string that is not what is stopping them.
      const errors = errorsOf({ ...complete, VAPID_SUBJECT: "nonsense" }, true);

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /NEXT_PUBLIC_VAPID_PUBLIC_KEY.*half-configured/,
          ),
          expect.stringMatching(/VAPID_PRIVATE_KEY.*half-configured/),
        ]),
      );
      expect(errors.join()).not.toMatch(/cannot configure/);
    });

    it("accepts an https subject, which RFC 8292 allows too", () => {
      expect(
        errorsOf(
          {
            ...complete,
            ...push,
            VAPID_SUBJECT: "https://example.com/contact",
          },
          true,
        ),
      ).toEqual([]);
    });
  });
});
