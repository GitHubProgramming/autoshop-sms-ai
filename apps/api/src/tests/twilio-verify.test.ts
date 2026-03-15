import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/app-config", () => ({
  getConfig: vi.fn(),
}));

import { fetchTwilioNumberConfig, verifyWebhookUrls } from "../services/twilio-verify";
import { getConfig } from "../db/app-config";

const mockGetConfig = vi.mocked(getConfig);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConfig.mockImplementation(async (key: string) => {
    if (key === "TWILIO_ACCOUNT_SID") return "AC1234567890";
    if (key === "TWILIO_AUTH_TOKEN") return "authtoken123";
    return null;
  });
});

describe("fetchTwilioNumberConfig", () => {
  it("returns config when Twilio API responds successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sms_url: "https://api.example.com/webhooks/twilio/sms",
        sms_method: "POST",
        voice_url: "https://api.example.com/webhooks/twilio/voice",
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "Test Number",
      }),
    });

    const result = await fetchTwilioNumberConfig("PNtest123", mockFetch);

    expect(result.success).toBe(true);
    expect(result.config?.sms_url).toBe("https://api.example.com/webhooks/twilio/sms");
    expect(result.config?.voice_url).toBe("https://api.example.com/webhooks/twilio/voice");
    expect(result.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC1234567890/IncomingPhoneNumbers/PNtest123.json",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns error when Twilio credentials missing", async () => {
    mockGetConfig.mockResolvedValue(null);

    const result = await fetchTwilioNumberConfig("PNtest123");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Twilio credentials not configured");
  });

  it("returns error when Twilio API returns non-OK", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: "Number not found" }),
    });

    const result = await fetchTwilioNumberConfig("PNinvalid", mockFetch);

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
    expect(result.error).toContain("Number not found");
  });

  it("returns error when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await fetchTwilioNumberConfig("PNtest123", mockFetch);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });
});

describe("verifyWebhookUrls", () => {
  const origin = "https://api.autoshop.example.com";

  it("returns pass when URLs match expected origin", () => {
    const result = verifyWebhookUrls(
      {
        sms_url: `${origin}/webhooks/twilio/sms`,
        sms_method: "POST",
        voice_url: `${origin}/webhooks/twilio/voice`,
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "Test",
      },
      origin
    );

    expect(result.sms_webhook.pass).toBe(true);
    expect(result.voice_webhook.pass).toBe(true);
  });

  it("returns fail when SMS URL points to wrong domain", () => {
    const result = verifyWebhookUrls(
      {
        sms_url: "https://old.example.com/webhooks/twilio/sms",
        sms_method: "POST",
        voice_url: `${origin}/webhooks/twilio/voice`,
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "Test",
      },
      origin
    );

    expect(result.sms_webhook.pass).toBe(false);
    expect(result.sms_webhook.expected).toBe(`${origin}/webhooks/twilio/sms`);
    expect(result.sms_webhook.actual).toBe("https://old.example.com/webhooks/twilio/sms");
    expect(result.voice_webhook.pass).toBe(true);
  });

  it("returns fail when voice URL is empty", () => {
    const result = verifyWebhookUrls(
      {
        sms_url: `${origin}/webhooks/twilio/sms`,
        sms_method: "POST",
        voice_url: null,
        voice_method: null,
        status_callback: null,
        status_callback_method: null,
        friendly_name: "Test",
      },
      origin
    );

    expect(result.sms_webhook.pass).toBe(true);
    expect(result.voice_webhook.pass).toBe(false);
    expect(result.voice_webhook.actual).toBeNull();
  });

  it("returns fail when both URLs are wrong", () => {
    const result = verifyWebhookUrls(
      {
        sms_url: "https://wrong.com/sms",
        sms_method: "POST",
        voice_url: "https://wrong.com/voice",
        voice_method: "POST",
        status_callback: null,
        status_callback_method: null,
        friendly_name: "Test",
      },
      origin
    );

    expect(result.sms_webhook.pass).toBe(false);
    expect(result.voice_webhook.pass).toBe(false);
  });
});
