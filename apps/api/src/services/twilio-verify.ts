import { getConfig } from "../db/app-config";

export interface TwilioWebhookConfig {
  sms_url: string | null;
  sms_method: string | null;
  voice_url: string | null;
  voice_method: string | null;
  status_callback: string | null;
  status_callback_method: string | null;
  friendly_name: string | null;
}

export interface TwilioVerifyResult {
  success: boolean;
  config: TwilioWebhookConfig | null;
  error: string | null;
}

/**
 * Fetches the webhook configuration for a Twilio phone number by its SID.
 * Calls Twilio REST API: GET /IncomingPhoneNumbers/{SID}.json
 */
export async function fetchTwilioNumberConfig(
  twilioSid: string,
  fetchFn: typeof fetch = fetch
): Promise<TwilioVerifyResult> {
  const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
  const authToken = await getConfig("TWILIO_AUTH_TOKEN");

  if (!accountSid || !authToken) {
    return { success: false, config: null, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${twilioSid}.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const res = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      return {
        success: false,
        config: null,
        error: `Twilio API ${res.status}: ${data.message || "unknown error"}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      success: true,
      config: {
        sms_url: (data.sms_url as string) || null,
        sms_method: (data.sms_method as string) || null,
        voice_url: (data.voice_url as string) || null,
        voice_method: (data.voice_method as string) || null,
        status_callback: (data.status_callback as string) || null,
        status_callback_method: (data.status_callback_method as string) || null,
        friendly_name: (data.friendly_name as string) || null,
      },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      config: null,
      error: `Twilio request failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Checks webhook URLs against expected values.
 * Returns per-check results with expected vs actual.
 */
export function verifyWebhookUrls(
  config: TwilioWebhookConfig,
  expectedOrigin: string
): {
  sms_webhook: { pass: boolean; expected: string; actual: string | null };
  voice_webhook: { pass: boolean; expected: string; actual: string | null };
} {
  const expectedSms = `${expectedOrigin}/webhooks/twilio/sms`;
  const expectedVoice = `${expectedOrigin}/webhooks/twilio/voice`;

  return {
    sms_webhook: {
      pass: config.sms_url === expectedSms,
      expected: expectedSms,
      actual: config.sms_url,
    },
    voice_webhook: {
      pass: config.voice_url === expectedVoice,
      expected: expectedVoice,
      actual: config.voice_url,
    },
  };
}
