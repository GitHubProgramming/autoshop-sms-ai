import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import { signZadarmaRequest } from "../utils/zadarma";

/**
 * Pinned-signature regression test.
 *
 * The expected authHeader below is computed OFFLINE with identical inputs using
 * Node's stock `crypto` module and hardcoded here. If anyone ever re-orders the
 * concat, drops the trailing slash from apiPath, or swaps sha1 ↔ sha256, this
 * test will fail before the change can reach Zadarma and produce a silent
 * `wrong signature` error in production.
 *
 * Inputs are intentionally boring, non-secret values. Do not put real creds
 * in this file.
 */
const FIXED = {
  apiKey: "test_key",
  apiSecret: "test_secret_12345",
  apiPath: "/v1/sms/send/",
  params: {
    caller_id: "+37045512300",
    message: "Labas",
    number: "+37061234567",
  },
};

// These three lines are the "source of truth" for the test. If the helper is
// correct, they match exactly what it produces. If you regenerate them, you
// must also run the helper against FIXED and confirm the new values match.
const EXPECTED_QUERY_STRING =
  "caller_id=%2B37045512300&message=Labas&number=%2B37061234567";
const EXPECTED_MD5 = "734a00543ffe1d82b86a9b5c0f9c8ada";
// Signature is base64(hex(hmac)) → 56 chars, NOT base64(raw_hmac) → 28 chars.
// Confirmed by Zadarma support (2026-04-11) and their GAS reference code.
const EXPECTED_HMAC_HEX = "871a3b46a43c9f947931a2f6b9d4f265dce19c6d";
const EXPECTED_AUTH_HEADER =
  "test_key:ODcxYTNiNDZhNDNjOWY5NDc5MzFhMmY2YjlkNGYyNjVkY2UxOWM2ZA==";

describe("signZadarmaRequest", () => {
  it("produces the pinned Authorization header for known inputs", () => {
    const { authHeader } = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    expect(authHeader).toBe(EXPECTED_AUTH_HEADER);
  });

  it("builds a form-urlencoded body in alphabetical key order", () => {
    const { body } = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    // URLSearchParams preserves insertion order; the helper inserts sorted keys.
    expect(body.toString()).toBe(EXPECTED_QUERY_STRING);
  });

  it("signature derivation matches the raw crypto primitives (algorithm pin)", () => {
    // Recompute step-by-step with stock crypto, mirroring PHP's
    // base64_encode(hash_hmac('sha1', $data, $key)) where hash_hmac
    // returns hex by default (raw_output=false).
    const md5 = crypto
      .createHash("md5")
      .update(EXPECTED_QUERY_STRING)
      .digest("hex");
    expect(md5).toBe(EXPECTED_MD5);

    const signData = FIXED.apiPath + EXPECTED_QUERY_STRING + md5;
    const hmacHex = crypto
      .createHmac("sha1", FIXED.apiSecret)
      .update(signData)
      .digest("hex");
    expect(hmacHex).toBe(EXPECTED_HMAC_HEX);

    const signature = Buffer.from(hmacHex, "utf8").toString("base64");

    const { authHeader } = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    expect(authHeader).toBe(`${FIXED.apiKey}:${signature}`);
  });

  it("key order in input is irrelevant (sort happens inside)", () => {
    const a = signZadarmaRequest(
      FIXED.apiPath,
      {
        number: FIXED.params.number,
        message: FIXED.params.message,
        caller_id: FIXED.params.caller_id,
      },
      FIXED.apiKey,
      FIXED.apiSecret
    );
    const b = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    expect(a.authHeader).toBe(b.authHeader);
    expect(a.body.toString()).toBe(b.body.toString());
  });

  it("changing any input produces a different signature", () => {
    const base = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    const diffMessage = signZadarmaRequest(
      FIXED.apiPath,
      { ...FIXED.params, message: "Labass" },
      FIXED.apiKey,
      FIXED.apiSecret
    );
    const diffSecret = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      "different_secret"
    );
    const diffPath = signZadarmaRequest(
      "/v1/sms/send", // missing trailing slash
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );

    expect(diffMessage.authHeader).not.toBe(base.authHeader);
    expect(diffSecret.authHeader).not.toBe(base.authHeader);
    expect(diffPath.authHeader).not.toBe(base.authHeader);
  });

  it("base64-encodes HEX string, not raw bytes (56 chars, not 28)", () => {
    // SHA-1 raw = 20 bytes → base64 = 28 chars (WRONG for Zadarma)
    // SHA-1 hex = 40 chars → base64 = 56 chars (CORRECT for Zadarma)
    // This test catches the exact bug that caused every API call to return
    // 401 Not authorized before the 2026-04-12 fix.
    const { authHeader } = signZadarmaRequest(
      FIXED.apiPath,
      FIXED.params,
      FIXED.apiKey,
      FIXED.apiSecret
    );
    const sigPart = authHeader.split(":").slice(1).join(":");
    expect(sigPart.length).toBe(56);
  });

  it("url-encodes values containing '+' and spaces", () => {
    const { body } = signZadarmaRequest(
      FIXED.apiPath,
      { number: "+37061234567", message: "hi there" },
      FIXED.apiKey,
      FIXED.apiSecret
    );
    // URLSearchParams encodes spaces as '+' — same as Zadarma's example.
    const str = body.toString();
    expect(str).toContain("message=hi+there");
    expect(str).toContain("number=%2B37061234567");
  });
});
