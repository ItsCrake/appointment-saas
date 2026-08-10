import { toHtml } from "./templates";
import type {
  NotificationChannel,
  NotificationProvider,
  OutboundMessage,
  SendResult,
} from "./types";
import { whatsappProvider } from "./whatsapp";

/**
 * Fallback used whenever a channel has no credentials. It "succeeds" and logs,
 * so the whole pipeline — enqueue, schedule, dispatch, dedupe — is exercisable
 * before any provider account exists. The name makes it obvious in the logs
 * that nothing actually left the building.
 */
const consoleProvider = (
  channel: NotificationChannel,
): NotificationProvider => ({
  name: "console",
  channel,
  async send(message) {
    console.info(
      `[notifications:console] ${channel} → ${message.recipient}\n` +
        (message.subject ? `subject: ${message.subject}\n` : "") +
        message.body,
    );
    return { ok: true };
  },
});

/** Resend transactional email. Set RESEND_API_KEY and NOTIFICATIONS_FROM_EMAIL. */
function resendProvider(): NotificationProvider | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;
  if (!apiKey || !from) return null;

  return {
    name: "resend",
    channel: "email",
    async send(message): Promise<SendResult> {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.recipient],
            subject: message.subject ?? "",
            text: message.body,
            html: toHtml(message.subject ?? "", message.body),
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          return {
            ok: false,
            error: `resend ${response.status}: ${detail.slice(0, 200)}`,
            // 4xx is a bad request; only 429/5xx are worth retrying.
            retryable: response.status === 429 || response.status >= 500,
          };
        }

        const data = (await response.json()) as { id?: string };
        return { ok: true, providerId: data.id };
      } catch (error) {
        return {
          ok: false,
          error: `resend request failed: ${(error as Error).message}`,
          retryable: true,
        };
      }
    },
  };
}

/**
 * Twilio for SMS and WhatsApp — same REST endpoint, the channel is encoded in
 * the `From`/`To` prefix.
 */
function twilioProvider(
  channel: "sms" | "whatsapp",
): NotificationProvider | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from =
    channel === "sms"
      ? process.env.TWILIO_SMS_FROM
      : process.env.TWILIO_WHATSAPP_FROM;

  if (!sid || !token || !from) return null;

  return {
    name: `twilio-${channel}`,
    channel,
    async send(message): Promise<SendResult> {
      const prefix = channel === "whatsapp" ? "whatsapp:" : "";
      const params = new URLSearchParams({
        From: `${prefix}${from}`,
        To: `${prefix}${toE164(message.recipient)}`,
        Body: message.body,
      });

      try {
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params,
          },
        );

        if (!response.ok) {
          const detail = await response.text();
          return {
            ok: false,
            error: `twilio ${response.status}: ${detail.slice(0, 200)}`,
            retryable: response.status === 429 || response.status >= 500,
          };
        }

        const data = (await response.json()) as { sid?: string };
        return { ok: true, providerId: data.sid };
      } catch (error) {
        return {
          ok: false,
          error: `twilio request failed: ${(error as Error).message}`,
          retryable: true,
        };
      }
    },
  };
}

/** Israeli local numbers (05XXXXXXXX) to E.164, which Twilio requires. */
export function toE164(phone: string, countryCode = "972") {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith(countryCode)) return `+${digits}`;
  if (digits.startsWith("0")) return `+${countryCode}${digits.slice(1)}`;
  return `+${digits}`;
}

/**
 * Resolves the provider for a channel at call time, so adding a key to the
 * environment switches channels on without a code change.
 */
export function getProvider(
  channel: NotificationChannel,
): NotificationProvider {
  if (channel === "email") return resendProvider() ?? consoleProvider("email");

  // WhatsApp has two possible backends and prefers the one that needs no
  // template approval — see `whatsapp.ts`. SMS has only Twilio.
  if (channel === "whatsapp") {
    return (
      whatsappProvider(() => twilioProvider("whatsapp")) ??
      consoleProvider("whatsapp")
    );
  }

  return twilioProvider(channel) ?? consoleProvider(channel);
}

/**
 * Whether a channel reaches a real recipient under the current environment.
 *
 * The console fallback reports success, so routing to an unconfigured channel
 * loses messages silently. Callers that *choose* a channel — rather than being
 * handed one — must check this first, or a paid SMS reminder becomes a log line
 * nobody reads.
 */
export function isChannelLive(channel: NotificationChannel): boolean {
  return getProvider(channel).name !== "console";
}

export function describeProviders() {
  return (["email", "sms", "whatsapp"] as const).map((channel) => ({
    channel,
    provider: getProvider(channel).name,
    live: isChannelLive(channel),
  }));
}

export type { OutboundMessage };
