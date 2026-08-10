import { toE164 } from "./providers";
import type { NotificationProvider, SendResult } from "./types";

/**
 * WhatsApp delivery, behind one interface with two possible backends.
 *
 * ---------------------------------------------------------------------------
 * THE TWO BACKENDS ARE NOT INTERCHANGEABLE, AND THE DIFFERENCE DECIDES THE
 * PRODUCT.
 *
 * **Twilio** speaks the official WhatsApp Business API. A message the business
 * sends *first* — a confirmation, a reminder — is "business-initiated", and
 * Meta requires a pre-approved template for it outside the 24-hour window that
 * opens when a client messages you. Twilio will happily accept a free-text send
 * and the platform will reject it, so a confirmation over Twilio WhatsApp needs
 * template approval before it delivers anything.
 *
 * **Green API** drives a real WhatsApp account through an unofficial gateway.
 * There is no template approval because there is no Business API involved — it
 * is the shop's own number, sending the way a person would. That is why it is
 * the default here: it is the one that works for an Israeli barber on the day
 * they sign up. It is also unofficial, which is a risk the operator takes on
 * knowingly and should not discover from a support ticket.
 *
 * The abstraction exists so that choice is a credential, not a rewrite. Both
 * satisfy `NotificationProvider`, so the outbox, the dedupe key, the retry
 * policy and the templates are identical either way.
 * ---------------------------------------------------------------------------
 */

/**
 * Green API addresses a chat, not a phone: `<international digits>@c.us`, with
 * no `+`. Derived from `toE164` rather than a second parser, so a number that
 * reaches SMS correctly reaches WhatsApp correctly.
 */
export function toWhatsAppChatId(phone: string): string {
  return `${toE164(phone).replace(/^\+/, "")}@c.us`;
}

/**
 * Green API. Set `GREEN_API_INSTANCE_ID` and `GREEN_API_TOKEN`.
 *
 * Returns null when either is missing, which is what lets `whatsappProvider`
 * fall through to Twilio and then to the console without a branch anywhere
 * else.
 */
export function greenApiProvider(): NotificationProvider | null {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!instanceId || !token) return null;

  // Configurable because Green API shards accounts across hosts, and a new
  // instance is routinely issued on a numbered one rather than the apex.
  const host = process.env.GREEN_API_HOST ?? "https://api.green-api.com";

  return {
    name: "green-api",
    channel: "whatsapp",
    async send(message): Promise<SendResult> {
      const url = `${host.replace(/\/+$/, "")}/waInstance${instanceId}/sendMessage/${token}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: toWhatsAppChatId(message.recipient),
            message: message.body,
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          return {
            ok: false,
            // The token is in the URL, so the URL never goes in the error.
            error: `green-api ${response.status}: ${detail.slice(0, 200)}`,
            // 466 is Green API's "quota exceeded", which clears on its own.
            retryable:
              response.status === 429 ||
              response.status === 466 ||
              response.status >= 500,
          };
        }

        const data = (await response.json()) as { idMessage?: string };
        return { ok: true, providerId: data.idMessage };
      } catch (error) {
        return {
          ok: false,
          error: `green-api request failed: ${(error as Error).message}`,
          retryable: true,
        };
      }
    },
  };
}

/**
 * The WhatsApp backend for this environment, or null when none is configured.
 *
 * Green API first: it needs no template approval, so a tenant configured with
 * both gets the one that actually delivers a confirmation today.
 */
export function whatsappProvider(
  twilioFallback: () => NotificationProvider | null,
): NotificationProvider | null {
  return greenApiProvider() ?? twilioFallback();
}

/** Which backend is live, for `check:env` and the deployment docs. */
export function describeWhatsApp(): {
  provider: "green-api" | "twilio" | null;
  needsTemplateApproval: boolean;
} {
  if (greenApiProvider()) {
    return { provider: "green-api", needsTemplateApproval: false };
  }
  const configured =
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM;

  return configured
    ? { provider: "twilio", needsTemplateApproval: true }
    : { provider: null, needsTemplateApproval: false };
}
