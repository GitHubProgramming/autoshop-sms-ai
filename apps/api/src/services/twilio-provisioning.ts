/**
 * twilio-provisioning.ts — full backend Twilio number provisioning.
 *
 * Replaces n8n WF-007 (deprecated 2026-04-07). All Twilio REST calls happen
 * inside the Node.js worker so the critical signup→trial→number flow has no
 * external orchestrator dependency.
 *
 * Key fact about the autoshop-ai Messaging Service:
 *   use_inbound_webhook_on_number = false
 * This means individual number SmsUrl is IGNORED — the service-level
 * inbound_request_url applies to all numbers in the service. Therefore we do
 * NOT need to set SmsUrl per number. Adding the number to the Messaging
 * Service is the only Twilio-side action required for inbound SMS to flow.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("twilio-provisioning");

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
const TWILIO_MESSAGING_API_BASE = "https://messaging.twilio.com/v1";

/**
 * Texas area codes used as fallback when the preferred area code has no
 * available numbers. Ordered roughly by metro size: Austin → Houston → Dallas
 * → DFW → Houston suburbs → San Antonio → Abilene area.
 */
export const TEXAS_AREA_CODES = [
  "512", "713", "214", "469", "832", "281", "346", "737", "325", "903",
];

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
}

function getCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error(
      "missing_twilio_credentials: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID must all be set",
    );
  }
  return { accountSid, authToken, messagingServiceSid };
}

function basicAuth(creds: TwilioCredentials): string {
  return (
    "Basic " +
    Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")
  );
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  capabilities: { sms: boolean; mms: boolean; voice: boolean };
}

/**
 * Search for available US local phone numbers in a specific area code that
 * support SMS. Returns up to `limit` candidates.
 */
export async function searchAvailableNumbers(
  areaCode: string,
  limit = 5,
): Promise<AvailableNumber[]> {
  const creds = getCredentials();
  const url =
    `${TWILIO_API_BASE}/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/Local.json` +
    `?AreaCode=${encodeURIComponent(areaCode)}&SmsEnabled=true&PageSize=${limit}`;

  const res = await fetch(url, {
    headers: { Authorization: basicAuth(creds) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`twilio_search_failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return (data.available_phone_numbers ?? []).map((n: any) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    capabilities: {
      sms: n.capabilities?.SMS === true,
      mms: n.capabilities?.MMS === true,
      voice: n.capabilities?.voice === true,
    },
  }));
}

/**
 * Purchase a specific phone number from Twilio.
 *
 * Note: we do NOT set SmsUrl on the number itself. The autoshop-ai Messaging
 * Service has use_inbound_webhook_on_number=false, so the service-level
 * inbound_request_url governs inbound SMS routing for every number in the
 * service. Setting SmsUrl per-number would have no effect.
 */
export async function purchaseNumber(
  phoneNumber: string,
  friendlyName?: string,
): Promise<{ sid: string; phoneNumber: string }> {
  const creds = getCredentials();
  const url = `${TWILIO_API_BASE}/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json`;
  const body = new URLSearchParams({
    PhoneNumber: phoneNumber,
    SmsMethod: "POST",
  });
  if (friendlyName) body.set("FriendlyName", friendlyName);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`twilio_purchase_failed: ${res.status} ${text}`);
  }
  const data: any = await res.json();
  return { sid: data.sid, phoneNumber: data.phone_number };
}

/**
 * Add a purchased number to the autoshop-ai Messaging Service. This is what
 * gives the number A2P 10DLC compliance and routes inbound SMS to the
 * canonical Fastify webhook configured on the Messaging Service.
 */
export async function addNumberToMessagingService(
  phoneNumberSid: string,
): Promise<void> {
  const creds = getCredentials();
  const url = `${TWILIO_MESSAGING_API_BASE}/Services/${creds.messagingServiceSid}/PhoneNumbers`;
  const body = new URLSearchParams({ PhoneNumberSid: phoneNumberSid });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuth(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `twilio_messaging_service_add_failed: ${res.status} ${text}`,
    );
  }
}

/**
 * Verify that a phone number is currently a member of the Messaging Service.
 * Used as a post-provisioning sanity check before marking the tenant ready.
 */
export async function verifyNumberInMessagingService(
  phoneNumberSid: string,
): Promise<boolean> {
  const creds = getCredentials();
  const url = `${TWILIO_MESSAGING_API_BASE}/Services/${creds.messagingServiceSid}/PhoneNumbers?PageSize=200`;

  const res = await fetch(url, {
    headers: { Authorization: basicAuth(creds) },
  });
  if (!res.ok) return false;
  const data: any = await res.json();
  return (data.phone_numbers ?? []).some((p: any) => p.sid === phoneNumberSid);
}

/**
 * Release a Twilio number back to the pool. Used both for cleanup in tests
 * and to roll back a purchase when adding the number to the Messaging Service
 * fails. 404 is treated as success (already gone).
 */
export async function releaseNumber(phoneNumberSid: string): Promise<void> {
  const creds = getCredentials();
  const url = `${TWILIO_API_BASE}/Accounts/${creds.accountSid}/IncomingPhoneNumbers/${phoneNumberSid}.json`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: basicAuth(creds) },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`twilio_release_failed: ${res.status} ${text}`);
  }
}

export interface ProvisionResult {
  sid: string;
  phoneNumber: string;
  areaCodeUsed: string;
  attemptedAreaCodes: string[];
}

/**
 * Top-level orchestrator. Tries the preferred area code first, falls back
 * through TEXAS_AREA_CODES if no numbers are available. On success the number
 * is purchased AND added to the Messaging Service AND verified. On any
 * failure after purchase, the number is released to avoid stranded inventory.
 *
 * Throws on:
 *   - no_numbers_available_in_any_area_code (every attempt returned empty)
 *   - twilio_purchase_failed (and the area code loop continues, unless funds/auth)
 *   - twilio_messaging_service_add_failed (after purchase: number is released)
 *   - post_purchase_verification_failed (number is released)
 *   - missing_twilio_credentials
 */
export async function provisionNumberForTenant(opts: {
  preferredAreaCode?: string;
  shopName?: string;
}): Promise<ProvisionResult> {
  const queue: string[] = [];
  if (opts.preferredAreaCode && /^\d{3}$/.test(opts.preferredAreaCode)) {
    queue.push(opts.preferredAreaCode);
  }
  for (const ac of TEXAS_AREA_CODES) {
    if (!queue.includes(ac)) queue.push(ac);
  }

  const attempted: string[] = [];
  let lastError: Error | null = null;

  for (const areaCode of queue) {
    attempted.push(areaCode);
    try {
      const numbers = await searchAvailableNumbers(areaCode, 1);
      if (numbers.length === 0) {
        log.info({ areaCode }, "no numbers available in area code, trying next");
        continue;
      }

      const candidate = numbers[0]!;
      const purchased = await purchaseNumber(
        candidate.phoneNumber,
        opts.shopName,
      );
      log.info(
        { sid: purchased.sid, phoneNumber: purchased.phoneNumber, areaCode },
        "number purchased",
      );

      try {
        await addNumberToMessagingService(purchased.sid);
      } catch (err) {
        log.error(
          { err, sid: purchased.sid },
          "add to messaging service failed; releasing number",
        );
        await releaseNumber(purchased.sid).catch((relErr) =>
          log.error({ relErr, sid: purchased.sid }, "release after add-failure also failed"),
        );
        throw err;
      }

      const verified = await verifyNumberInMessagingService(purchased.sid);
      if (!verified) {
        log.error(
          { sid: purchased.sid },
          "post-purchase verification failed; releasing number",
        );
        await releaseNumber(purchased.sid).catch(() => undefined);
        throw new Error("post_purchase_verification_failed");
      }

      return {
        sid: purchased.sid,
        phoneNumber: purchased.phoneNumber,
        areaCodeUsed: areaCode,
        attemptedAreaCodes: [...attempted],
      };
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message || "";
      log.warn({ areaCode, err: msg }, "area code attempt failed");

      // Non-retryable errors short-circuit the whole loop.
      if (
        /insufficient[_ ]?funds/i.test(msg) ||
        /forbidden/i.test(msg) ||
        /unauthor/i.test(msg) ||
        /missing_twilio_credentials/.test(msg) ||
        /twilio_messaging_service_add_failed/.test(msg) ||
        /post_purchase_verification_failed/.test(msg)
      ) {
        throw lastError;
      }
      // Otherwise continue to next area code
    }
  }

  throw new Error(
    `no_numbers_available_in_any_area_code: tried ${attempted.join(",")}` +
      (lastError ? ` (last_error: ${lastError.message})` : ""),
  );
}
