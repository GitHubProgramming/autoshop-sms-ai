import * as crypto from "node:crypto";

export interface ZadarmaSignedRequest {
  /**
   * Value for the Authorization header: `${apiKey}:${signature}` (literal colon,
   * no "Bearer " prefix).
   */
  authHeader: string;
  /** Form-urlencoded body with params in alphabetical key order. */
  body: URLSearchParams;
}

/**
 * Sign a Zadarma API request using HMAC-SHA1.
 *
 * Formula (verbatim from Zadarma docs + proven in n8n sandbox
 * `n8n/workflows/TEST/wf002-lt-sandbox-send-sms.json`):
 *
 *   1. Sort params alphabetically by key
 *   2. queryString = RFC1738 form-urlencoded `k=v` pairs joined with `&`
 *                    (same encoding as PHP's `http_build_query` with
 *                    PHP_QUERY_RFC1738 — space becomes `+`, `+` becomes `%2B`)
 *   3. md5Hash     = md5(queryString) as hex
 *   4. signData    = apiPath + queryString + md5Hash
 *   5. hmacHex     = hmac-sha1(signData, apiSecret) as **hex string** (40 chars)
 *   6. signature   = base64(hmacHex)   ← base64 of the hex STRING, not raw bytes
 *   7. authHeader  = `${apiKey}:${signature}`
 *
 * Step 5–6 is critical: PHP's `hash_hmac('sha1', ..., $secret)` returns hex by
 * default (`raw_output = false`), and the PHP SDK passes that hex string straight
 * into `base64_encode()`. Node's `crypto.createHmac().digest('base64')` encodes
 * the raw 20-byte HMAC — a shorter, different value. The correct Node equivalent
 * of PHP's `base64_encode(hash_hmac('sha1', $data, $key))` is:
 *
 *     const hex = crypto.createHmac('sha1', key).update(data).digest('hex');
 *     const sig = Buffer.from(hex, 'utf8').toString('base64');
 *
 * Confirmed by Zadarma support (2026-04-11) and their GAS reference code.
 *
 * IMPORTANT: the wire body and the signed string MUST use byte-for-byte
 * identical encoding. We use `URLSearchParams` for both so they cannot drift.
 * (An earlier draft used `encodeURIComponent` for the signature and
 * `URLSearchParams` for the body — those encode spaces differently (`%20` vs
 * `+`) and produce a silent `wrong signature` error for any message
 * containing a space.)
 *
 * `apiPath` MUST include the trailing slash (e.g. "/v1/sms/send/") and MUST
 * NOT include the domain — it is part of the signed string and a mismatch
 * produces a `wrong signature` error from Zadarma.
 *
 * This helper is pure — no I/O, no env access — so it is trivially unit-
 * testable and safe to call from any context.
 */
export function signZadarmaRequest(
  apiPath: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string
): ZadarmaSignedRequest {
  // Build a URLSearchParams with keys in alphabetical order. URLSearchParams
  // preserves insertion order, so sort → append gives us a deterministic,
  // sorted, RFC1738-encoded serialization that is identical between the
  // signed string and the wire body.
  const sortedKeys = Object.keys(params).sort();
  const body = new URLSearchParams();
  for (const k of sortedKeys) body.append(k, params[k]);

  const queryString = body.toString();
  const md5Hash = crypto.createHash("md5").update(queryString).digest("hex");
  const signData = apiPath + queryString + md5Hash;

  // Two-step encoding: HMAC → hex string → base64.
  // PHP's hash_hmac returns hex by default; Zadarma's server base64-decodes our
  // signature back to hex and compares against its own hex HMAC. If we base64
  // the raw 20-byte digest instead, the signature is shorter (28 vs 56 chars)
  // and Zadarma rejects with "Not authorized".
  const hmacHex = crypto
    .createHmac("sha1", apiSecret)
    .update(signData)
    .digest("hex");
  const signature = Buffer.from(hmacHex, "utf8").toString("base64");

  return {
    authHeader: `${apiKey}:${signature}`,
    body,
  };
}
