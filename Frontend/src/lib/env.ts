export type EnvRequirement = "required" | "production" | "optional";

export type EnvVar = {
  name: string;
  requirement: EnvRequirement;
  group: string;
  description: string;
  /** Shown when the variable is missing, so the fix is obvious. */
  howTo: string;
  /** Optional shape check — catches a pasted placeholder or wrong value. */
  validate?: (value: string) => string | null;
};

const isUrl = (value: string) => {
  try {
    new URL(value);
    return null;
  } catch {
    return "must be a valid URL";
  }
};

export const ENV_VARS: EnvVar[] = [
  {
    name: "NEXT_PUBLIC_APP_URL",
    requirement: "production",
    group: "App",
    description: "Public origin, used in notification links and OG metadata.",
    howTo: 'Set to your deployed origin, e.g. "https://book.example.com".',
    validate: (value) =>
      isUrl(value) ??
      (value.includes("localhost") && process.env.NODE_ENV === "production"
        ? "still points at localhost"
        : null),
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    requirement: "required",
    group: "Supabase",
    description: "Supabase project URL, used by the auth client.",
    howTo: "Supabase → Project Settings → API → Project URL.",
    validate: isUrl,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    requirement: "required",
    group: "Supabase",
    description: "Public anon key. Safe to expose; RLS is what protects data.",
    howTo: "Supabase → Project Settings → API → anon public key.",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    requirement: "optional",
    group: "Supabase",
    description:
      "Admin key. Only used by `npm run db:claim` to resolve emails.",
    howTo: "Supabase → Project Settings → API → service_role. Never expose it.",
  },
  {
    name: "DATABASE_URL",
    requirement: "required",
    group: "Database",
    description: "Pooled connection (port 6543) used by the app at runtime.",
    howTo: "Supabase → Database → Connection string → Transaction pooler.",
    validate: (value) =>
      value.startsWith("postgres")
        ? value.includes("[") || value.includes("]")
          ? "still contains the [YOUR-PASSWORD] placeholder brackets"
          : null
        : "must be a postgres connection string",
  },
  {
    name: "DIRECT_URL",
    requirement: "required",
    group: "Database",
    description: "Direct/session connection (port 5432) used by migrations.",
    howTo: "Supabase → Database → Connection string → Session pooler.",
    validate: (value) =>
      value.includes("[") || value.includes("]")
        ? "still contains the [YOUR-PASSWORD] placeholder brackets"
        : null,
  },
  {
    name: "CRON_SECRET",
    requirement: "production",
    group: "Notifications",
    description:
      "Bearer token for /api/cron/notifications. Without it the route 401s and no reminder is ever sent.",
    howTo: "Generate with: openssl rand -hex 32",
    validate: (value) =>
      value.length < 16 ? "too short — use at least 16 characters" : null,
  },
  {
    name: "RESEND_API_KEY",
    requirement: "optional",
    group: "Notifications",
    description:
      "Email provider. Without it, email falls back to the console provider and nothing is delivered.",
    howTo: "resend.com → API Keys.",
    validate: (value) =>
      value.startsWith("re_") ? null : 'Resend keys normally start with "re_"',
  },
  {
    name: "NOTIFICATIONS_FROM_EMAIL",
    requirement: "optional",
    group: "Notifications",
    description: "Sender address. Required alongside RESEND_API_KEY.",
    howTo:
      'Must use a Resend-verified domain, e.g. "תורים <noreply@yourdomain.com>".',
  },
  {
    name: "TWILIO_ACCOUNT_SID",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description: "Enables the SMS and WhatsApp channels.",
    howTo: "twilio.com → Console → Account SID.",
  },
  {
    name: "TWILIO_AUTH_TOKEN",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description: "Twilio auth token.",
    howTo: "twilio.com → Console → Auth Token.",
  },
  {
    name: "TWILIO_SMS_FROM",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description: "Sending number for SMS, in E.164.",
    howTo: "twilio.com → Phone Numbers.",
  },
  {
    name: "TWILIO_WHATSAPP_FROM",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description: "Sending number for WhatsApp, in E.164.",
    howTo: "twilio.com → Messaging → WhatsApp senders.",
  },
];

export type EnvIssue = {
  name: string;
  level: "error" | "warning";
  reason: string;
  howTo: string;
};

export type EnvReport = {
  ok: boolean;
  issues: EnvIssue[];
  present: string[];
};

/**
 * Pure check so it can run from a CLI, a test, or a health endpoint.
 * `production` requirements are only errors when NODE_ENV is production.
 */
export function checkEnv(
  env: Record<string, string | undefined> = process.env,
  { production = env.NODE_ENV === "production" }: { production?: boolean } = {},
): EnvReport {
  const issues: EnvIssue[] = [];
  const present: string[] = [];

  for (const spec of ENV_VARS) {
    const value = env[spec.name]?.trim();

    if (!value) {
      const isError =
        spec.requirement === "required" ||
        (spec.requirement === "production" && production);

      issues.push({
        name: spec.name,
        level: isError ? "error" : "warning",
        reason: "not set",
        howTo: spec.howTo,
      });
      continue;
    }

    present.push(spec.name);

    const problem = spec.validate?.(value);
    if (problem) {
      issues.push({
        name: spec.name,
        level: spec.requirement === "optional" ? "warning" : "error",
        reason: problem,
        howTo: spec.howTo,
      });
    }
  }

  // Half-configured email is worse than none: it looks live but cannot send.
  const hasKey = Boolean(env.RESEND_API_KEY?.trim());
  const hasFrom = Boolean(env.NOTIFICATIONS_FROM_EMAIL?.trim());
  if (hasKey !== hasFrom) {
    issues.push({
      name: hasKey ? "NOTIFICATIONS_FROM_EMAIL" : "RESEND_API_KEY",
      level: "error",
      reason: "email is half-configured — both variables are needed to send",
      howTo: "Set both, or clear both to fall back to the console provider.",
    });
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues,
    present,
  };
}
