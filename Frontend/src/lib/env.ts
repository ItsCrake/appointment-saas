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

/**
 * The VAPID `sub` claim, per RFC 8292 §2.1: a `mailto:` or `https:` URI that
 * lets a push service reach whoever is sending.
 *
 * Exported because `lib/push.ts` applies the identical rule before calling
 * `setVapidDetails`. Two copies would let `check:env` pass on a value the
 * runtime then refuses — the failure mode this whole check exists to prevent.
 *
 * The placeholder is rejected explicitly. It ships in `.env.example`, so it is
 * the single most likely wrong value to reach production, and it would
 * otherwise pass every structural test here.
 */
export const VAPID_SUBJECT_PLACEHOLDER = "mailto:you@yourdomain.com";

export function validateVapidSubject(value: string): string | null {
  if (value === VAPID_SUBJECT_PLACEHOLDER) {
    return "is still the example value from .env.example";
  }

  if (value.startsWith("mailto:")) {
    return value.slice("mailto:".length).includes("@")
      ? null
      : "mailto: must contain an email address";
  }

  if (value.startsWith("https://")) return isUrl(value);

  return "must be a mailto: or https: URI (RFC 8292)";
}

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
  /*
   * `production`, not `optional`, since image uploads started using it: the
   * dashboard renders an upload control on the settings, staff and appearance
   * screens, and without this key every one of them refuses at the moment an
   * owner picks a file. Unlike the notification channels the failure is at
   * least loud — it says so on screen rather than reporting success — but a
   * visibly broken control on three screens is not a state to launch in.
   */
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    requirement: "production",
    group: "Supabase",
    description:
      "Admin key. Mints signed upload URLs for owner image uploads, and used by `npm run db:claim`.",
    howTo:
      "Supabase → Project Settings → API → service_role. Never expose it. Then run `npm run storage:setup`.",
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
    requirement: "production",
    group: "Notifications",
    description:
      "Email provider. Without it, email falls back to the console provider and nothing is delivered.",
    howTo: "resend.com → API Keys.",
    validate: (value) =>
      value.startsWith("re_")
        ? null
        : 'does not look like a Resend key — they start with "re_"',
  },
  {
    name: "NOTIFICATIONS_FROM_EMAIL",
    requirement: "production",
    group: "Notifications",
    description: "Sender address. Required alongside RESEND_API_KEY.",
    howTo:
      'Must use a Resend-verified domain, e.g. "תורים <noreply@yourdomain.com>".',
    // Accepts both "addr@domain" and "Name <addr@domain>"; Resend rejects
    // anything without an address with a 422 that only surfaces at send time.
    validate: (value) =>
      /[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+/.test(value)
        ? null
        : "must contain an email address",
  },
  /*
   * "ליבי", the in-dashboard voice assistant. `optional` for the same reason
   * web push is: the failure is visible and self-limiting. With no key the
   * microphone is not rendered at all, so an owner is never offered a control
   * that cannot work — and there is deliberately no console fallback, because a
   * fake transcript would either invent an appointment or refuse every
   * sentence.
   *
   * The **only** model key this product uses, since the Anthropic-era
   * implementation was retired. One key, one provider, one bill.
   */
  {
    name: "OPENAI_API_KEY",
    requirement: "optional",
    group: "Voice assistant",
    description:
      "OpenAI key for ליבי — Whisper transcription, intent, and speech. Without it the dashboard microphone is hidden.",
    howTo: "platform.openai.com → API keys.",
    validate: (value) =>
      value.startsWith("sk-")
        ? null
        : 'does not look like an OpenAI key — they start with "sk-"',
  },
  {
    name: "OPENAI_TTS_VOICE",
    requirement: "optional",
    group: "Voice assistant",
    description:
      "Which OpenAI voice ליבי speaks in. Defaults to nova, which reads Hebrew most naturally. An unrecognised value falls back rather than muting her.",
    howTo: "One of alloy, echo, fable, onyx, nova, shimmer.",
    validate: (value) =>
      ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(
        value.trim().toLowerCase(),
      )
        ? null
        : "not an OpenAI voice — nova will be used instead",
  },
  /*
   * ElevenLabs — speech out only. `optional` because the assistant works
   * without it: `speak()` falls back to OpenAI's `tts-1`, which reads Hebrew
   * with an audible foreign accent but reads it. The pair is all-or-nothing —
   * a key with no voice id is a 404 on every turn, so `elevenLabsConfig()`
   * treats it as absent and stays on OpenAI rather than going mute.
   */
  {
    name: "ELEVENLABS_API_KEY",
    requirement: "optional",
    group: "Voice assistant",
    description:
      "ElevenLabs key for ליבי's speech. Needs ELEVENLABS_VOICE_ID alongside it; without both, speech falls back to OpenAI tts-1.",
    howTo: "elevenlabs.io → Profile → API Keys.",
  },
  {
    name: "ELEVENLABS_VOICE_ID",
    requirement: "optional",
    group: "Voice assistant",
    description:
      "Which ElevenLabs voice ליבי speaks in. No default: an arbitrary premade voice billed to the shop's account is worse than falling back.",
    howTo: "elevenlabs.io → Voices → the voice's ID.",
  },
  {
    name: "ELEVENLABS_MODEL_ID",
    requirement: "optional",
    group: "Voice assistant",
    description:
      "eleven_v3 (default, most expressive, ~3.0s), eleven_multilingual_v2 (~1.2s) or eleven_turbo_v2_5 (~0.6s). Anything else falls back to the default.",
    howTo: "Leave unset unless the turn feels slow — then eleven_turbo_v2_5.",
    validate: (value) =>
      [
        "eleven_v3",
        "eleven_multilingual_v2",
        "eleven_turbo_v2_5",
      ].includes(value.trim())
        ? null
        : "not a model this pipeline uses — eleven_v3 will be used",
  },
  /*
   * Web push. `optional` rather than `production` because the failure is
   * visible and self-limiting: with no keys the settings card says push is not
   * configured, and every other alert channel still fires. Nothing is silently
   * lost, which is the bar the Resend and Twilio entries are held to.
   */
  {
    name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    requirement: "optional",
    group: "Web push",
    description:
      "VAPID public key. Public by design — the browser needs it to subscribe.",
    howTo: "Generate both keys with: npm run push:keys",
  },
  {
    name: "VAPID_PRIVATE_KEY",
    requirement: "optional",
    group: "Web push",
    description: "VAPID private key. Signs every push; never expose it.",
    howTo: "Generate both keys with: npm run push:keys",
  },
  {
    name: "VAPID_SUBJECT",
    requirement: "optional",
    group: "Web push",
    description:
      "Contact for the push service, as mailto: or https: (RFC 8292). Required whenever the key pair is set — push refuses to configure without it.",
    howTo: 'A real inbox you monitor, e.g. "mailto:support@yourdomain.com".',
    validate: validateVapidSubject,
  },
  {
    name: "SUPER_ADMIN_EMAILS",
    requirement: "optional",
    group: "Platform console",
    description:
      "Comma-separated emails allowed into /master. Empty denies everyone.",
    howTo:
      "Set to the platform owner's login email. Anyone listed can read every tenant's client data, so keep the list short.",
  },
  /*
   * Twilio is `production`, not `optional`, because the Pro tier *sells* SMS
   * reminders. The same rule that makes Resend a production requirement applies
   * with more force here: an unconfigured channel falls back to the console
   * provider and reports success, so a deploy without these keys would take
   * money for reminders it silently never sends. A green deploy check must not
   * coexist with a paid feature that cannot fire.
   */
  {
    name: "TWILIO_ACCOUNT_SID",
    requirement: "production",
    group: "Notifications (SMS/WhatsApp)",
    description: "Enables the SMS and WhatsApp channels, sold on the Pro tier.",
    howTo: "twilio.com → Console → Account SID.",
  },
  {
    name: "TWILIO_AUTH_TOKEN",
    requirement: "production",
    group: "Notifications (SMS/WhatsApp)",
    description: "Twilio auth token.",
    howTo: "twilio.com → Console → Auth Token.",
  },
  {
    name: "TWILIO_SMS_FROM",
    requirement: "production",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Sending number for SMS, in E.164. Without it Pro reminders fall back to email.",
    howTo: "twilio.com → Phone Numbers.",
  },
  {
    name: "TWILIO_WHATSAPP_FROM",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Sending number for the official WhatsApp Business API. Needs a Meta-approved template for confirmations and reminders — see GREEN_API_INSTANCE_ID for the alternative.",
    howTo: "twilio.com → Messaging → WhatsApp senders.",
  },
  /*
   * The Meta WhatsApp Cloud API — the platform's own Business account, talking
   * to Meta directly rather than through a reseller. This is the preferred
   * backend when configured: templates are addressed by name, so they are
   * portable between deployments in a way Twilio's per-account Content SIDs are
   * not.
   *
   * Optional for the same reason as everything else in this group: WhatsApp
   * falls through to SMS and then email when it is not configured, so nothing
   * breaks — the message arrives by another route.
   */
  {
    name: "WHATSAPP_PHONE_NUMBER_ID",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Phone number ID from the Meta WhatsApp Business account. Preferred WhatsApp backend; needs the three approved templates.",
    howTo: "developers.facebook.com → your app → WhatsApp → API Setup.",
  },
  {
    name: "WHATSAPP_ACCESS_TOKEN",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Permanent access token for the Meta app. Required alongside the phone number ID.",
    howTo:
      "developers.facebook.com → System Users → generate a token with whatsapp_business_messaging.",
  },
  {
    name: "WHATSAPP_API_VERSION",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Graph API version to call. Defaults to v23.0. Set it when Meta retires that version.",
    howTo: "developers.facebook.com → Graph API → Changelog.",
  },
  {
    name: "DISABLE_WHATSAPP_DISPATCH",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Cost guard. Any value other than false/0/no/off stops every WhatsApp send before the HTTP call. Messages are logged and the outbox row is marked skipped.",
    howTo: "Leave unset in production. Set it to 1 while testing internally.",
  },
  /*
   * Green API is the WhatsApp backend that works on day one. It drives the
   * shop's own account rather than the official Business API, so a booking
   * confirmation needs no template approval. Optional because WhatsApp falls
   * through to SMS and then email when it is not configured — nothing breaks,
   * the message simply arrives by another route.
   */
  {
    name: "GREEN_API_INSTANCE_ID",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Green API instance. Preferred WhatsApp backend: no Meta template approval, so confirmations send immediately.",
    howTo: "green-api.com → Instances → idInstance.",
  },
  {
    name: "GREEN_API_TOKEN",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description: "Green API token. Required alongside the instance id.",
    howTo: "green-api.com → Instances → apiTokenInstance.",
  },
  {
    name: "GREEN_API_HOST",
    requirement: "optional",
    group: "Notifications (SMS/WhatsApp)",
    description:
      "Override the Green API host. Defaults to https://api.green-api.com; new instances are often issued on a numbered host.",
    howTo:
      "Copy the host shown beside your instance, e.g. https://7103.api.greenapi.com.",
    validate: isUrl,
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
  /**
   * Which provider `getProvider("email")` will resolve to under this env.
   * Mirrors the credential check in `lib/notifications/providers.ts` — the two
   * must agree, or the check reports a delivery path the app does not take.
   */
  emailChannel: "resend" | "console";
  /**
   * Whether `sendPushToBusiness` will actually reach a device under this env.
   * Mirrors `ensureConfigured()` in `lib/push.ts`, including the subject rule —
   * the two must agree, or this reports a channel the runtime then refuses.
   */
  pushLive: boolean;
  /**
   * Whether money can actually be collected.
   *
   * Reported rather than enforced, unlike Resend and Twilio. There is no
   * provider to configure until stage 8d, so failing the check would block
   * every deploy on something nobody can fix yet. The runtime guard is what
   * makes that safe: the console provider **refuses** in production rather
   * than simulating, so a deploy without a provider cannot mark anyone paid.
   * Flip this to a hard error when the concrete adapter lands.
   */
  billingLive: boolean;
  /**
   * Whether the WhatsApp cost guard is currently suppressing every send.
   *
   * Reported prominently because this is the one variable whose *presence*
   * breaks the product: WhatsApp is the only live client channel here, so a
   * deploy that ships with it set tells no client anything, and every screen
   * still looks like it worked.
   */
  whatsappSuppressed: boolean;
};

/**
 * Values of `DISABLE_WHATSAPP_DISPATCH` that still permit sending.
 *
 * **Deliberately an allowlist of *off* values rather than a check for "true",
 * because this guard protects money.** The expensive direction is a typo:
 * `DISABLE_WHATSAPP_DISPATCH=ture` compared strictly against `"true"` reads as
 * *enabled* and starts billing on a run somebody believed was suppressed. So
 * anything set that is not explicitly off disables dispatch. A typo costs a
 * confusing quiet hour; the opposite costs money and, on the official API,
 * message-quality rating.
 */
const DISPATCH_PERMITTED_VALUES = ["", "false", "0", "no", "off"];

export function whatsappDispatchDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.DISABLE_WHATSAPP_DISPATCH;
  if (raw === undefined) return false;
  return !DISPATCH_PERMITTED_VALUES.includes(raw.trim().toLowerCase());
}

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
    // Severity follows the spec's tier and the mode — not whether the problem
    // is a missing value or a malformed one. Otherwise a short CRON_SECRET
    // would block a dev run that an absent one waves through.
    const level: EnvIssue["level"] =
      spec.requirement === "required" ||
      (spec.requirement === "production" && production)
        ? "error"
        : "warning";

    const value = env[spec.name]?.trim();

    if (!value) {
      issues.push({
        name: spec.name,
        level,
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
        level,
        reason: problem,
        howTo: spec.howTo,
      });
    }
  }

  // Half-configured email is worse than none: it looks live but cannot send.
  // This is an error in every mode — unlike a channel that is simply off, it
  // cannot be an intentional state.
  const hasKey = Boolean(env.RESEND_API_KEY?.trim());
  const hasFrom = Boolean(env.NOTIFICATIONS_FROM_EMAIL?.trim());
  if (hasKey !== hasFrom) {
    const missing = hasKey ? "NOTIFICATIONS_FROM_EMAIL" : "RESEND_API_KEY";
    const issue: EnvIssue = {
      name: missing,
      level: "error",
      reason: "email is half-configured — both variables are needed to send",
      howTo: "Set both, or clear both to fall back to the console provider.",
    };
    // Under production rules the loop has already queued a bare "not set" for
    // this name. Replace it rather than reporting the same variable twice.
    const queued = issues.findIndex((i) => i.name === missing);
    if (queued === -1) issues.push(issue);
    else issues[queued] = issue;
  }

  /**
   * Web push follows the same half-configured rule as email, for the same
   * reason: a partially set trio is a deployment mistake rather than a channel
   * deliberately switched off, and it fails at the worst moment — `push:keys`
   * generates a pair and prints a *placeholder* subject beside it, so pasting
   * two of the three lines is the natural way to get here.
   *
   * `setVapidDetails` throws without a valid subject, so the alternative is not
   * "push works a bit". It is a caught exception on the first booking and an
   * owner whose notifications never arrive.
   */
  const pushVars = [
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ] as const;
  const setPushVars = pushVars.filter((name) => Boolean(env[name]?.trim()));

  /** Replaces any queued issue for `name`, so a variable is reported once. */
  const raise = (name: string, reason: string, howTo: string) => {
    const issue: EnvIssue = { name, level: "error", reason, howTo };
    const queued = issues.findIndex((i) => i.name === name);
    if (queued === -1) issues.push(issue);
    else issues[queued] = issue;
  };

  const allPushSet = setPushVars.length === pushVars.length;
  const subjectProblem = allPushSet
    ? validateVapidSubject(env.VAPID_SUBJECT!.trim())
    : null;

  if (setPushVars.length > 0 && !allPushSet) {
    for (const name of pushVars) {
      if (setPushVars.includes(name)) continue;
      raise(
        name,
        "web push is half-configured — all three variables are needed to send",
        "Set all three, or clear all three to switch push off.",
      );
    }
  }

  /**
   * A bad subject is only a *warning* on its own, because the variable is
   * optional and an unconfigured channel is a legitimate state. Alongside a
   * real key pair it is an **error**: `setVapidDetails` throws on it, so push
   * would refuse at runtime while every screen in the product still claimed it
   * was configured. Severity follows the consequence, not the tier.
   */
  if (subjectProblem) {
    raise(
      "VAPID_SUBJECT",
      `web push cannot configure — the subject ${subjectProblem}`,
      'A real inbox you monitor, e.g. "mailto:support@yourdomain.com".',
    );
  }

  const pushLive = allPushSet && subjectProblem === null;

  /**
   * A deploy that suppresses WhatsApp is a deploy where no client hears
   * anything, because WhatsApp is the only live client channel on this
   * product — and unlike a missing credential, nothing else in the system
   * looks wrong. The booking succeeds, the screen confirms, the outbox row
   * reads `skipped`, and only somebody reading the database would know.
   *
   * So it is an **error** under production rules, by the same principle that
   * makes Resend and Twilio production requirements: a channel a tier sells
   * must not resolve to something that delivers nothing. It stays a plain
   * warning in development, which is where the flag is meant to be used.
   */
  const whatsappSuppressed = whatsappDispatchDisabled(env);
  if (whatsappSuppressed && production) {
    raise(
      "DISABLE_WHATSAPP_DISPATCH",
      "every WhatsApp message is suppressed — clients would be told nothing",
      "Unset it, or set it to `false`, before deploying.",
    );
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    issues,
    present,
    emailChannel: hasKey && hasFrom ? "resend" : "console",
    pushLive,
    // No provider adapter exists yet, so this is always false. It is surfaced
    // so `check:env` states it outright instead of leaving it to be discovered
    // by a tenant clicking a disabled button.
    billingLive: false,
    whatsappSuppressed,
  };
}
