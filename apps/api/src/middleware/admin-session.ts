import { createHmac } from "crypto";
import { FastifyReply } from "fastify";

/**
 * Admin session cookie — httpOnly, server-signed.
 *
 * Cookie value format: <base64url(payload)>.<hex(hmac)>
 * Payload: JSON { email, iat }
 *
 * No tenant. No JWT. No localStorage. Pure admin identity.
 */

const COOKIE_NAME = "admin_session";
const MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required for admin session signing");
  return secret;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(encoded: string): string {
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return Buffer.from(b64, "base64").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

// ── Public API ───────────────────────────────────────────────────────────────

export { COOKIE_NAME };

export interface AdminSession {
  email: string;
  iat: number;
}

/**
 * Set the admin session cookie on the reply.
 */
export function setAdminSessionCookie(reply: FastifyReply, email: string): void {
  const payload = JSON.stringify({ email: email.toLowerCase().trim(), iat: Math.floor(Date.now() / 1000) });
  const encoded = base64urlEncode(payload);
  const signature = sign(encoded);
  const value = `${encoded}.${signature}`;

  const isProduction = (process.env.PUBLIC_ORIGIN ?? "").startsWith("https");

  reply.setCookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Parse and verify the admin session cookie value.
 * Returns null if missing, tampered, or expired.
 */
export function parseAdminSessionCookie(cookieValue: string | undefined): AdminSession | null {
  if (!cookieValue) return null;

  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = cookieValue.slice(0, dotIndex);
  const providedSig = cookieValue.slice(dotIndex + 1);

  // Verify signature
  const expectedSig = sign(encoded);
  if (providedSig.length !== expectedSig.length) return null;

  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  // Decode payload
  try {
    const json = base64urlDecode(encoded);
    const data = JSON.parse(json) as { email?: string; iat?: number };
    if (!data.email || typeof data.iat !== "number") return null;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now - data.iat > MAX_AGE_SECONDS) return null;

    return { email: data.email, iat: data.iat };
  } catch {
    return null;
  }
}

/**
 * Clear the admin session cookie.
 */
export function clearAdminSessionCookie(reply: FastifyReply): void {
  const isProduction = (process.env.PUBLIC_ORIGIN ?? "").startsWith("https");
  reply.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}
