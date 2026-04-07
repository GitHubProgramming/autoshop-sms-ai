import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  searchAvailableNumbers,
  purchaseNumber,
  addNumberToMessagingService,
  verifyNumberInMessagingService,
  releaseNumber,
  provisionNumberForTenant,
  TEXAS_AREA_CODES,
} from "../services/twilio-provisioning";

const ENV = {
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "authtest",
  TWILIO_MESSAGING_SERVICE_SID: "MGtest",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchAvailableNumbers", () => {
  it("returns mapped candidates on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        available_phone_numbers: [
          {
            phone_number: "+15125550100",
            friendly_name: "(512) 555-0100",
            capabilities: { SMS: true, MMS: true, voice: true },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await searchAvailableNumbers("512", 1);

    expect(out).toHaveLength(1);
    expect(out[0]!.phoneNumber).toBe("+15125550100");
    expect(out[0]!.capabilities.sms).toBe(true);
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("AreaCode=512");
    expect(calledUrl).toContain("SmsEnabled=true");
  });

  it("returns empty when Twilio has no numbers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ available_phone_numbers: [] })));
    const out = await searchAvailableNumbers("999");
    expect(out).toHaveLength(0);
  });

  it("throws on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500)),
    );
    await expect(searchAvailableNumbers("512")).rejects.toThrow(/twilio_search_failed: 500/);
  });
});

describe("purchaseNumber", () => {
  it("returns sid + phoneNumber on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ sid: "PNabc", phone_number: "+15125550100" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await purchaseNumber("+15125550100", "Shop");

    expect(out).toEqual({ sid: "PNabc", phoneNumber: "+15125550100" });
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("POST");
  });

  it("throws on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "nope" }, 400)),
    );
    await expect(purchaseNumber("+15125550100")).rejects.toThrow(/twilio_purchase_failed: 400/);
  });
});

describe("addNumberToMessagingService", () => {
  it("succeeds on 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ sid: "PNabc" }, 201)));
    await expect(addNumberToMessagingService("PNabc")).resolves.toBeUndefined();
  });

  it("throws on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "no" }, 404)),
    );
    await expect(addNumberToMessagingService("PNabc")).rejects.toThrow(
      /twilio_messaging_service_add_failed: 404/,
    );
  });
});

describe("verifyNumberInMessagingService", () => {
  it("returns true when sid is in the service list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ phone_numbers: [{ sid: "PN1" }, { sid: "PN2" }] }),
      ),
    );
    expect(await verifyNumberInMessagingService("PN2")).toBe(true);
  });

  it("returns false when sid is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ phone_numbers: [{ sid: "PN1" }] })),
    );
    expect(await verifyNumberInMessagingService("PNZ")).toBe(false);
  });

  it("returns false on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(await verifyNumberInMessagingService("PNZ")).toBe(false);
  });
});

describe("releaseNumber", () => {
  it("treats 404 as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(releaseNumber("PNabc")).resolves.toBeUndefined();
  });

  it("throws on other error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(releaseNumber("PNabc")).rejects.toThrow(/twilio_release_failed: 500/);
  });
});

describe("provisionNumberForTenant", () => {
  it("succeeds on first area code", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("AvailablePhoneNumbers")) {
        return jsonResponse({
          available_phone_numbers: [
            { phone_number: "+15125550100", friendly_name: "x", capabilities: { SMS: true, MMS: true, voice: true } },
          ],
        });
      }
      if (url.includes("/IncomingPhoneNumbers.json") && init?.method === "POST") {
        return jsonResponse({ sid: "PNok", phone_number: "+15125550100" });
      }
      if (url.includes(`/Services/${ENV.TWILIO_MESSAGING_SERVICE_SID}/PhoneNumbers`) && init?.method === "POST") {
        return jsonResponse({ sid: "PNok" }, 201);
      }
      if (url.includes(`/Services/${ENV.TWILIO_MESSAGING_SERVICE_SID}/PhoneNumbers`)) {
        return jsonResponse({ phone_numbers: [{ sid: "PNok" }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionNumberForTenant({ preferredAreaCode: "512", shopName: "Shop" });

    expect(result.sid).toBe("PNok");
    expect(result.phoneNumber).toBe("+15125550100");
    expect(result.areaCodeUsed).toBe("512");
    expect(result.attemptedAreaCodes).toEqual(["512"]);
  });

  it("falls back to next area code when primary has no numbers", async () => {
    let searches = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("AvailablePhoneNumbers")) {
        searches++;
        // First call (AreaCode=999) → empty; second call (AreaCode=512) → one number
        if (url.includes("AreaCode=999")) {
          return jsonResponse({ available_phone_numbers: [] });
        }
        return jsonResponse({
          available_phone_numbers: [
            { phone_number: "+15125550100", friendly_name: "x", capabilities: { SMS: true, MMS: true, voice: true } },
          ],
        });
      }
      if (url.includes("/IncomingPhoneNumbers.json") && init?.method === "POST") {
        return jsonResponse({ sid: "PNok", phone_number: "+15125550100" });
      }
      if (url.includes("/Services/") && init?.method === "POST") {
        return jsonResponse({ sid: "PNok" }, 201);
      }
      if (url.includes("/Services/")) {
        return jsonResponse({ phone_numbers: [{ sid: "PNok" }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionNumberForTenant({ preferredAreaCode: "999" });

    expect(searches).toBeGreaterThanOrEqual(2);
    expect(result.attemptedAreaCodes[0]).toBe("999");
    expect(result.attemptedAreaCodes).toContain("512");
    expect(result.areaCodeUsed).not.toBe("999");
  });

  it("throws when no area code has any numbers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ available_phone_numbers: [] })),
    );
    await expect(
      provisionNumberForTenant({ preferredAreaCode: "999" }),
    ).rejects.toThrow(/no_numbers_available_in_any_area_code/);
  });

  it("rolls back the purchase when add-to-service fails", async () => {
    let releaseCalled = false;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: any) => {
      if (url.includes("AvailablePhoneNumbers")) {
        return jsonResponse({
          available_phone_numbers: [
            { phone_number: "+15125550100", friendly_name: "x", capabilities: { SMS: true } },
          ],
        });
      }
      if (url.includes("/IncomingPhoneNumbers.json") && init?.method === "POST") {
        return jsonResponse({ sid: "PNbad", phone_number: "+15125550100" });
      }
      if (url.includes("/Services/") && init?.method === "POST") {
        return jsonResponse({ message: "no" }, 400);
      }
      if (url.includes("/IncomingPhoneNumbers/PNbad.json") && init?.method === "DELETE") {
        releaseCalled = true;
        return jsonResponse({}, 204);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisionNumberForTenant({ preferredAreaCode: "512" }),
    ).rejects.toThrow(/twilio_messaging_service_add_failed/);
    expect(releaseCalled).toBe(true);
  });

  it("throws missing_twilio_credentials when env is incomplete", async () => {
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    await expect(
      provisionNumberForTenant({ preferredAreaCode: "512" }),
    ).rejects.toThrow(/missing_twilio_credentials/);
  });
});

describe("TEXAS_AREA_CODES", () => {
  it("contains the pilot area code 325", () => {
    expect(TEXAS_AREA_CODES).toContain("325");
  });
});
