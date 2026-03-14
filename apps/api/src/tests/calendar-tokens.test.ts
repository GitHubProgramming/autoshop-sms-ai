import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";

// vi.hoisted ensures mocks are available inside vi.mock factories
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

vi.mock("../routes/auth/google", () => ({
  decryptToken: mocks.decryptToken,
  encryptToken: mocks.encryptToken,
}));

import { calendarTokensRoute } from "../routes/internal/calendar-tokens";

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ENCRYPTED_ACCESS = "iv1:tag1:enc_access";
const ENCRYPTED_REFRESH = "iv2:tag2:enc_refresh";
const DECRYPTED_ACCESS = "ya29.real-access-token";
const DECRYPTED_REFRESH = "1//real-refresh-token";
const CALENDAR_ID = "primary";

function futureExpiry(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

function pastExpiry(): string {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

function dbRow(overrides: Record<string, string> = {}) {
  return {
    access_token: ENCRYPTED_ACCESS,
    refresh_token: ENCRYPTED_REFRESH,
    token_expiry: futureExpiry(60), // 1 hour from now (well beyond 5-min buffer)
    calendar_id: CALENDAR_ID,
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(calendarTokensRoute, { prefix: "/internal" });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /internal/calendar-tokens/:tenantId", () => {
  let savedGoogleClientId: string | undefined;
  let savedGoogleClientSecret: string | undefined;
  let savedEncryptionKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    savedGoogleClientId = process.env.GOOGLE_CLIENT_ID;
    savedGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    savedEncryptionKey = process.env.ENCRYPTION_KEY;

    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.ENCRYPTION_KEY = "test-encryption-key-32-chars-ok!";

    mocks.decryptToken.mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_ACCESS) return DECRYPTED_ACCESS;
      if (enc === ENCRYPTED_REFRESH) return DECRYPTED_REFRESH;
      return "decrypted-" + enc;
    });
    mocks.encryptToken.mockReturnValue("iv3:tag3:enc_refreshed");
    mocks.query.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = savedGoogleClientId;
    process.env.GOOGLE_CLIENT_SECRET = savedGoogleClientSecret;
    process.env.ENCRYPTION_KEY = savedEncryptionKey;
    vi.restoreAllMocks();
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it("returns 400 for invalid tenantId (not a UUID)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/internal/calendar-tokens/not-a-uuid",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid tenantId" });
    expect(mocks.query).not.toHaveBeenCalled();
    await app.close();
  });

  // ── Not found ───────────────────────────────────────────────────────────

  it("returns 404 when no calendar tokens exist for tenant", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "No calendar tokens for tenant" });
    await app.close();
  });

  // ── Happy path: valid (non-expired) token ───────────────────────────────

  it("returns decrypted tokens when token is not expired", async () => {
    const row = dbRow();
    mocks.query.mockResolvedValueOnce([row]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBe(DECRYPTED_ACCESS);
    expect(body.refresh_token).toBe(DECRYPTED_REFRESH);
    expect(body.token_expiry).toBe(row.token_expiry);
    expect(body.calendar_id).toBe(CALENDAR_ID);
    await app.close();
  });

  // ── Token refresh: happy path ───────────────────────────────────────────

  it("refreshes token when expired and returns new access_token", async () => {
    const row = dbRow({ token_expiry: pastExpiry() });
    mocks.query.mockResolvedValueOnce([row]); // SELECT
    mocks.query.mockResolvedValueOnce(undefined); // UPDATE after refresh

    const newAccessToken = "ya29.new-refreshed-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: newAccessToken, expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBe(newAccessToken);
    expect(body.refresh_token).toBe(DECRYPTED_REFRESH);
    expect(body.calendar_id).toBe(CALENDAR_ID);

    // Verify fetch was called with correct params
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(opts?.method).toBe("POST");

    // Verify DB was updated
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.encryptToken).toHaveBeenCalledWith(newAccessToken);

    fetchMock.mockRestore();
    await app.close();
  });

  // ── Token within 5-min buffer also triggers refresh ─────────────────────

  it("refreshes token when within 5-minute expiry buffer", async () => {
    // 3 minutes from now — within the 5-min buffer
    const row = dbRow({ token_expiry: futureExpiry(3) });
    mocks.query.mockResolvedValueOnce([row]);
    mocks.query.mockResolvedValueOnce(undefined);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "ya29.buffer-refresh", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBe("ya29.buffer-refresh");

    fetchMock.mockRestore();
    await app.close();
  });

  // ── Token refresh fails: returns stale token ────────────────────────────

  it("returns stale token when Google refresh fails (HTTP error)", async () => {
    const row = dbRow({ token_expiry: pastExpiry() });
    mocks.query.mockResolvedValueOnce([row]);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 401 })
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Falls back to stale decrypted token
    expect(body.access_token).toBe(DECRYPTED_ACCESS);
    expect(body.refresh_token).toBe(DECRYPTED_REFRESH);

    fetchMock.mockRestore();
    await app.close();
  });

  // ── Missing Google credentials: refresh skipped, stale returned ─────────

  it("returns stale token when GOOGLE_CLIENT_ID is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const row = dbRow({ token_expiry: pastExpiry() });
    mocks.query.mockResolvedValueOnce([row]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBe(DECRYPTED_ACCESS);
    await app.close();
  });

  it("returns stale token when GOOGLE_CLIENT_SECRET is missing", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;

    const row = dbRow({ token_expiry: pastExpiry() });
    mocks.query.mockResolvedValueOnce([row]);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().access_token).toBe(DECRYPTED_ACCESS);
    await app.close();
  });

  // ── Decryption failure ──────────────────────────────────────────────────

  it("returns 500 when token decryption throws", async () => {
    const row = dbRow();
    mocks.query.mockResolvedValueOnce([row]);
    mocks.decryptToken.mockImplementation(() => {
      throw new Error("decryption failed");
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Token decryption failed" });
    await app.close();
  });

  // ── Refresh token decryption failure ────────────────────────────────────

  it("returns 500 when refresh_token is corrupted (decryption fails in both refresh and stale paths)", async () => {
    const row = dbRow({ token_expiry: pastExpiry() });
    mocks.query.mockResolvedValueOnce([row]);

    // refresh_token decryption fails everywhere — both in refreshAccessToken
    // and in the stale fallback path (which also decrypts refresh_token)
    mocks.decryptToken.mockImplementation((enc: string) => {
      if (enc === ENCRYPTED_REFRESH) throw new Error("bad refresh token");
      if (enc === ENCRYPTED_ACCESS) return DECRYPTED_ACCESS;
      return "decrypted-" + enc;
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Token decryption failed" });
    await app.close();
  });

  // ── DB query passes correct tenantId ────────────────────────────────────

  it("queries the database with the correct tenantId", async () => {
    mocks.query.mockResolvedValueOnce([]);

    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: `/internal/calendar-tokens/${TEST_TENANT_ID}`,
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("tenant_calendar_tokens"),
      [TEST_TENANT_ID]
    );
    await app.close();
  });
});
