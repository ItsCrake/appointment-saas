import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  describeWhatsApp,
  greenApiProvider,
  toWhatsAppChatId,
} from "@/lib/notifications/whatsapp";
import { getProvider, isChannelLive } from "@/lib/notifications/providers";

/**
 * The WhatsApp backend selection.
 *
 * The two backends are not interchangeable — Twilio's official Business API
 * needs a Meta-approved template for a message the shop sends first, Green API
 * does not — so *which one is chosen* is a product decision and worth pinning.
 */

const KEYS = [
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

describe("channel selection", () => {
  it("falls back to the console when nothing is configured", () => {
    expect(getProvider("whatsapp").name).toBe("console");
    expect(isChannelLive("whatsapp")).toBe(false);
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
