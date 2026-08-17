import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describeWhatsApp,
  greenApiProvider,
  metaCloudProvider,
  toWhatsAppChatId,
} from "@/lib/notifications/whatsapp";
import { getProvider, isChannelLive } from "@/lib/notifications/providers";
import type { WhatsAppTemplateRef } from "@/lib/notifications/types";

/**
 * The WhatsApp backend selection.
 *
 * The three backends are not interchangeable — the two official paths need a
 * Meta-approved template for a message the shop sends first, Green API does not
 * — so *which one is chosen* is a product decision and worth pinning.
 */

const KEYS = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_API_VERSION",
  "WHATSAPP_GRAPH_HOST",
  "GREEN_API_INSTANCE_ID",
  "GREEN_API_TOKEN",
  "GREEN_API_HOST",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("toWhatsAppChatId", () => {
  it("turns an Israeli local number into a Green API chat id", () => {
    expect(toWhatsAppChatId("050-123-4567")).toBe("972501234567@c.us");
    expect(toWhatsAppChatId("0501234567")).toBe("972501234567@c.us");
  });

  it("accepts a number that is already international", () => {
    expect(toWhatsAppChatId("+972501234567")).toBe("972501234567@c.us");
    expect(toWhatsAppChatId("00972501234567")).toBe("972501234567@c.us");
  });

  it("never leaves a plus in the chat id", () => {
    // Green API addresses a chat, not a phone; a `+` produces a silent no-op.
    for (const input of ["+972501234567", "0501234567", "972501234567"]) {
      expect(toWhatsAppChatId(input).startsWith("+")).toBe(false);
      expect(toWhatsAppChatId(input).endsWith("@c.us")).toBe(true);
    }
  });
});

describe("greenApiProvider", () => {
  it("is null until both credentials are present", () => {
    expect(greenApiProvider()).toBeNull();

    process.env.GREEN_API_INSTANCE_ID = "1101";
    expect(greenApiProvider()).toBeNull();

    process.env.GREEN_API_TOKEN = "token";
    expect(greenApiProvider()?.name).toBe("green-api");
  });
});

describe("metaCloudProvider", () => {
  const TOKEN = "34e64171-cb3e-47b3-8548-82297eff1270";

  const confirmation: WhatsAppTemplateRef = {
    name: "appointment_confirmation",
    language: "he",
    header: ["דני"],
    parameters: ["מספרת בלאק", "יום חמישי, 20/08/2026", "14:30"],
    buttonUrlSuffix: TOKEN,
  };

  /** Configures the backend and captures the one request it makes. */
  function withCapturedSend() {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-token";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.HBg" }] }), {
        status: 200,
      }),
    );

    return {
      fetchMock,
      async send(template?: WhatsAppTemplateRef) {
        const result = await metaCloudProvider()!.send({
          channel: "whatsapp",
          recipient: "050-123-4567",
          body: "rendered hebrew body",
          ...(template ? { template } : {}),
        });
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        return {
          result,
          url: String(url ?? ""),
          payload: init?.body ? JSON.parse(String(init.body)) : undefined,
          init,
        };
      },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is null until both credentials are present", () => {
    expect(metaCloudProvider()).toBeNull();

    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    expect(metaCloudProvider()).toBeNull();

    process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-token";
    expect(metaCloudProvider()?.name).toBe("meta-cloud");
  });

  /**
   * The refusal that keeps a silent loss impossible. Meta accepts a free-text
   * business-initiated message and then drops it, so the five kinds with no
   * approved template must fail here rather than appear to have been sent.
   */
  it("refuses to send a message with no approved template", async () => {
    const { fetchMock, send } = withCapturedSend();
    const { result } = await send();

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ retryable: false });
    // And it never reaches the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("addresses the template by name on the pinned Graph version", async () => {
    const { url, payload, init } = await withCapturedSend().send(confirmation);

    expect(url).toBe("https://graph.facebook.com/v23.0/123456789/messages");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer EAAG-token",
    );
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("appointment_confirmation");
    expect(payload.template.language).toEqual({ code: "he" });
  });

  /**
   * Meta takes bare international digits. Twilio requires the leading `+`, and
   * sending Twilio's form here is accepted and then silently misrouted.
   */
  it("sends the recipient as international digits with no plus", async () => {
    const { payload } = await withCapturedSend().send(confirmation);
    expect(payload.to).toBe("972501234567");
  });

  /**
   * The payload shape this whole change exists for: three components, each
   * numbered from 1 on its own, in the order Meta reads them.
   */
  it("builds header, body and button as separate components", async () => {
    const { payload } = await withCapturedSend().send(confirmation);

    expect(payload.template.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "דני" }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "מספרת בלאק" },
          { type: "text", text: "יום חמישי, 20/08/2026" },
          { type: "text", text: "14:30" },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: TOKEN }],
      },
    ]);
  });

  it("omits the components a template does not have", async () => {
    // `reminder_2h`: no header, no button — sending either would be rejected.
    const { payload } = await withCapturedSend().send({
      name: "reminder_2h",
      language: "he",
      parameters: ["מספרת בלאק", "14:30", "הרצל 10"],
    });

    expect(payload.template.components).toHaveLength(1);
    expect(payload.template.components[0].type).toBe("body");
  });

  it("reports the message id Meta returns", async () => {
    const { result } = await withCapturedSend().send(confirmation);
    expect(result).toEqual({ ok: true, providerId: "wamid.HBg" });
  });

  /**
   * A 4xx from Meta is a fact about the message or the credentials — an
   * unapproved template, an expired token, a recipient with no WhatsApp
   * account. Retrying spends the outbox's five attempts proving it.
   */
  it("retries a rate limit but not a rejection", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-token";
    const provider = metaCloudProvider()!;

    const message = {
      channel: "whatsapp" as const,
      recipient: "0501234567",
      body: "body",
      template: confirmation,
    };

    for (const [status, retryable] of [
      [400, false],
      [401, false],
      [429, true],
      [503, true],
    ] as const) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "nope" } }), {
          status,
        }),
      );
      expect(await provider.send(message)).toMatchObject({
        ok: false,
        retryable,
      });
      vi.restoreAllMocks();
    }
  });
});

describe("channel selection", () => {
  it("falls back to the console when nothing is configured", () => {
    expect(getProvider("whatsapp").name).toBe("console");
    expect(isChannelLive("whatsapp")).toBe(false);
    // `check:env` prints this verdict under Delivery, and "off" is the branch
    // that tells an operator no client will hear anything by WhatsApp.
    expect(describeWhatsApp()).toEqual({
      provider: null,
      needsTemplateApproval: false,
    });
  });

  /**
   * Meta Cloud outranks both. An earlier rule preferred Green API because it
   * needs no template approval and so delivers on day one — true while no
   * templates existed. Now that this deployment has three approved on its own
   * Business account, configuring the official credentials is a deliberate act
   * and the unofficial gateway must not quietly outrank it.
   */
  it("prefers Meta Cloud over every other backend", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
    process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-token";
    process.env.GREEN_API_INSTANCE_ID = "1101";
    process.env.GREEN_API_TOKEN = "token";
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_WHATSAPP_FROM = "+14155238886";

    expect(getProvider("whatsapp").name).toBe("meta-cloud");
    expect(isChannelLive("whatsapp")).toBe(true);
    expect(describeWhatsApp()).toEqual({
      provider: "meta-cloud",
      needsTemplateApproval: true,
    });
  });

  it("uses Twilio when only Twilio is configured", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_WHATSAPP_FROM = "+14155238886";

    expect(getProvider("whatsapp").name).toBe("twilio-whatsapp");
    expect(describeWhatsApp()).toEqual({
      provider: "twilio",
      needsTemplateApproval: true,
    });
  });

  it("prefers Green API when both are configured", () => {
    // Deliberate: Green API needs no template approval, so it is the one that
    // can actually deliver a booking confirmation on the day a shop signs up.
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_WHATSAPP_FROM = "+14155238886";
    process.env.GREEN_API_INSTANCE_ID = "1101";
    process.env.GREEN_API_TOKEN = "token";

    expect(getProvider("whatsapp").name).toBe("green-api");
    expect(describeWhatsApp()).toEqual({
      provider: "green-api",
      needsTemplateApproval: false,
    });
  });

  it("leaves SMS on Twilio regardless of the WhatsApp backend", () => {
    process.env.GREEN_API_INSTANCE_ID = "1101";
    process.env.GREEN_API_TOKEN = "token";

    // Green API is a WhatsApp gateway; it must not be mistaken for an SMS one.
    expect(getProvider("sms").name).toBe("console");
  });
});
