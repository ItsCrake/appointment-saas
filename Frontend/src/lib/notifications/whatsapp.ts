import { toE164 } from "./providers";
import type {
  NotificationProvider,
  SendResult,
  WhatsAppTemplateRef,
} from "./types";

/**
 * WhatsApp delivery, behind one interface with three possible backends.
 *
 * ---------------------------------------------------------------------------
 * THE BACKENDS ARE NOT INTERCHANGEABLE, AND THE DIFFERENCE DECIDES THE PRODUCT.
 *
 * **Meta Cloud API** is the operator's own WhatsApp Business account, talking
 * to Meta directly: their phone number, their templates, their access token.
 * This is the path this deployment actually runs on. A message the business
 * sends *first* — a confirmation, a reminder — is "business-initiated", and
 * Meta requires a pre-approved template for it outside the 24-hour window that
 * opens when a client messages you. Templates are addressed **by name**, which
 * is what makes them portable between deployments.
 *
 * **Twilio** speaks the same official API as a reseller, and is the reason the
 * template abstraction is shaped the way it is. It addresses an approved
 * template by **Content SID** rather than by name, and it flattens Meta's
 * per-component numbering into one namespace — so the same template needs a
 * different payload through Twilio than through Meta. Kept for the operator who
 * arrives with a Twilio account; unused here, and unproven.
 *
 * **Green API** drives a real WhatsApp account through an unofficial gateway.
 * There is no template approval because there is no Business API involved — it
 * is the shop's own number, sending the way a person would. That is what makes
 * it work for an Israeli barber on the day they sign up. It is also unofficial,
 * which is a risk the operator takes on knowingly and should not discover from
 * a support ticket.
 *
 * The abstraction exists so that choice is a credential, not a rewrite. All
 * three satisfy `NotificationProvider`, so the outbox, the dedupe key, the
 * retry policy and the templates are identical either way.
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
 * The Graph API version this code was written against.
 *
 * Overridable because Meta retires versions on a rolling schedule and a pinned
 * constant in a repository outlives the version it names. Pinned rather than
 * floating because an unversioned Graph URL silently follows Meta's default,
 * which is a payload change arriving without a deploy.
 */
const DEFAULT_GRAPH_VERSION = "v23.0";

/**
 * Meta's own component payload for one approved template.
 *
 * Each component is a separate object with its own parameter array, and Meta
 * numbers each of them from 1 independently — the header's `{{1}}` and the
 * body's `{{1}}` are different variables. Flattening them into one list, which
 * is what Twilio does, produces a message with the wrong words in it.
 *
 * The URL button takes **only the tail** appended to the base URL frozen at
 * approval time, and its `index` is the button's position in the approved
 * template, not a parameter number.
 */
export function metaTemplateComponents(template: WhatsAppTemplateRef) {
  const text = (value: string) => ({ type: "text" as const, text: value });
  const components: Array<Record<string, unknown>> = [];

  if (template.header?.length) {
    components.push({ type: "header", parameters: template.header.map(text) });
  }

  if (template.parameters.length) {
    components.push({
      type: "body",
      parameters: template.parameters.map(text),
    });
  }

  if (template.buttonUrlSuffix !== undefined) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [text(template.buttonUrlSuffix)],
    });
  }

  return components;
}

/**
 * The Meta WhatsApp Cloud API — the operator's own Business account.
 *
 * Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`. Returns null
 * without both, which is what lets `whatsappProvider` fall through to Green API
 * and then Twilio and then the console without a branch anywhere else.
 */
export function metaCloudProvider(): NotificationProvider | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;

  const host = process.env.WHATSAPP_GRAPH_HOST ?? "https://graph.facebook.com";
  const version = process.env.WHATSAPP_API_VERSION ?? DEFAULT_GRAPH_VERSION;

  return {
    name: "meta-cloud",
    channel: "whatsapp",
    async send(message): Promise<SendResult> {
      /**
       * The official path refuses rather than sending free text Meta will accept
       * and then drop — a silent loss is the one outcome the outbox exists to
       * prevent. Five message kinds have no approved template yet, and this is
       * where that fact stops being theoretical.
       */
      if (!message.template) {
        return {
          ok: false,
          error:
            "whatsapp: no approved Meta template for this message kind — refusing to send free text",
          // A missing template is a configuration fact, not a blip. Retrying
          // would burn the outbox's five attempts on the same refusal.
          retryable: false,
        };
      }

      const url = `${host.replace(/\/+$/, "")}/${version}/${phoneNumberId}/messages`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            // Meta takes bare international digits, not the leading `+` that
            // Twilio requires. Derived from the same normaliser either way, so
            // a number that reaches SMS correctly reaches WhatsApp correctly.
            to: toE164(message.recipient).replace(/^\+/, ""),
            type: "template",
            template: {
              name: message.template.name,
              language: { code: message.template.language },
              components: metaTemplateComponents(message.template),
            },
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          return {
            ok: false,
            // The token is a Bearer header, not in the URL, so the URL is safe
            // to name — but the response body is not echoed beyond a slice.
            error: `meta-cloud ${response.status}: ${detail.slice(0, 200)}`,
            /**
             * 4xx from Meta is a fact about the message or the credentials: an
             * unapproved template, an expired token, a recipient with no
             * WhatsApp account. None of those improve on the second attempt,
             * and retrying spends the outbox's budget proving it.
             */
            retryable: response.status === 429 || response.status >= 500,
          };
        }

        const data = (await response.json()) as {
          messages?: Array<{ id?: string }>;
        };
        return { ok: true, providerId: data.messages?.[0]?.id };
      } catch (error) {
        return {
          ok: false,
          error: `meta-cloud request failed: ${(error as Error).message}`,
          retryable: true,
        };
      }
    },
  };
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
 * **Meta Cloud first.** An earlier version preferred Green API on the grounds
 * that it needs no template approval and therefore delivers on day one. That
 * reasoning held while no templates existed; now that this deployment has three
 * approved on its own Business account, configuring the official credentials is
 * a deliberate act and the unofficial gateway should not quietly outrank it.
 * Green API stays ahead of Twilio for the original reason.
 */
export function whatsappProvider(
  twilioFallback: () => NotificationProvider | null,
): NotificationProvider | null {
  return metaCloudProvider() ?? greenApiProvider() ?? twilioFallback();
}

/** Which backend is live, for `check:env` and the deployment docs. */
export function describeWhatsApp(): {
  provider: "meta-cloud" | "green-api" | "twilio" | null;
  needsTemplateApproval: boolean;
} {
  if (metaCloudProvider()) {
    return { provider: "meta-cloud", needsTemplateApproval: true };
  }
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
