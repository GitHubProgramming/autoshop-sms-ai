import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { isTokenExpired, refreshAccessToken } from "../services/google-token-refresh";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ENCRYPTED_REFRESH = "iv2:tag2:enc_refresh";
const DECRYPTED_REFRESH = "1//real-refresh-token";

// ── Setup ────────────────────────────────────────────────────────────────────

let savedClientId: string | undefined;
let savedClientSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedClientId = process.env.GOOGLE_CLIENT_ID;
  savedClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  mocks.decryptToken.mockReturnValue(DECRYPTED_REFRESH);
  mocks.encryptToken.mockReturnValue("iv3:tag3:enc_new");
  mocks.query.mockResolvedValue([]);
});

afterEach(() => {
  process.env.GOOGLE_CLIENT_ID = savedClientId;
  process.env.GOOGLE_CLIENT_SECRET = savedClientSecret;
  vi.restoreAllMocks();
});

// ── isTokenExpired ───────────────────────────────────────────────────────────

describe("isTokenExpired", () => {
  it("returns true for past expiry", () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(isTokenExpired(past)).toBe(true);
  });

  it("returns true when within 5-minute buffer", () => {
    const soon = new Date(Date.now() + 3 * 60 * 1000).toISOString(); // 3 min
    expect(isTokenExpired(soon)).toBe(true);
  });

  it("returns false when well beyond buffer", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    expect(isTokenExpired(future)).toBe(false);
  });

  it("accepts Date objects", () => {
    const past = new Date(Date.now() - 1000);
    expect(isTokenExpired(past)).toBe(true);
  });
});

// ── refreshAccessToken ───────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  it("returns null when GOOGLE_CLIENT_ID is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);
    expect(result).toBeNull();
  });

  it("returns null when GOOGLE_CLIENT_SECRET is missing", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);
    expect(result).toBeNull();
  });

  it("returns null when refresh_token decryption fails", async () => {
    mocks.decryptToken.mockImplementation(() => {
      throw new Error("bad token");
    });
    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);
    expect(result).toBeNull();
  });

  it("returns null when Google token endpoint returns error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 401 })
    );

    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);
    expect(result).toBeNull();

    fetchMock.mockRestore();
  });

  it("returns null when fetch throws (network error)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED")
    );

    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);
    expect(result).toBeNull();

    fetchMock.mockRestore();
  });

  it("refreshes token successfully and updates DB", async () => {
    const newToken = "ya29.brand-new-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: newToken, expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await refreshAccessToken(TENANT_ID, ENCRYPTED_REFRESH);

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe(newToken);
    expect(new Date(result!.tokenExpiry).getTime()).toBeGreaterThan(Date.now());

    // Verify DB update
    expect(mocks.encryptToken).toHaveBeenCalledWith(newToken);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenant_calendar_tokens"),
      expect.arrayContaining([TENANT_ID])
    );

    // Verify correct POST body
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(opts?.method).toBe("POST");
    const bodyStr = opts?.body as string;
    expect(bodyStr).toContain("grant_type=refresh_token");
    expect(bodyStr).toContain("client_id=test-client-id");
    expect(bodyStr).toContain("client_secret=test-client-secret");
    expect(bodyStr).toContain(`refresh_token=${encodeURIComponent(DECRYPTED_REFRESH)}`);

    fetchMock.mockRestore();
  });
});
