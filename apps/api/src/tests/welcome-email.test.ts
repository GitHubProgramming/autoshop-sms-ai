import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildWelcomeEmailHtml,
  formatUsPhone,
  sendWelcomeEmailForProvisionedTenant,
} from "../services/welcome-email";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("welcome-email template", () => {
  it("formats US E.164 number as +1 (XXX) XXX-XXXX", () => {
    expect(formatUsPhone("+15125551234")).toBe("+1 (512) 555-1234");
  });

  it("html body contains business name, formatted phone, and A2P disclaimer", () => {
    const html = buildWelcomeEmailHtml({
      to: "owner@shop.com",
      businessName: "Acme Auto",
      phoneNumber: "+15125551234",
      dashboardUrl: "https://autoshopsmsai.com/app",
      supportEmail: "support@autoshopsmsai.com",
    });
    expect(html).toContain("Acme Auto");
    expect(html).toContain("+1 (512) 555-1234");
    expect(html).toContain("A2P 10DLC");
    expect(html).toContain("pending carrier review");
    expect(html).toContain("https://autoshopsmsai.com/app");
    expect(html).toContain("support@autoshopsmsai.com");
  });
});

describe("sendWelcomeEmailForProvisionedTenant — non-US (LT) isolation", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    (globalThis as any).fetch = fetchSpy;
    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue({ ok: true, text: async () => "" });
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("skips send for non-US (+370 LT) numbers and never queries DB", async () => {
    const queryFn = vi.fn();
    await sendWelcomeEmailForProvisionedTenant(
      TENANT_ID,
      "+37045512300",
      queryFn as any,
    );
    expect(queryFn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends for US (+1) numbers via Resend", async () => {
    const queryFn = vi.fn().mockResolvedValue([
      { shop_name: "Acme Auto", owner_email: "owner@shop.com" },
    ]);
    await sendWelcomeEmailForProvisionedTenant(
      TENANT_ID,
      "+15125551234",
      queryFn as any,
    );
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse((opts as any).body);
    expect(body.subject).toBe("Your AutoShop SMS AI number is ready");
    expect(body.to).toEqual(["owner@shop.com"]);
    expect(body.html).toContain("Acme Auto");
    expect(body.html).toContain("+1 (512) 555-1234");
  });

  it("never throws when Resend errors", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network down"));
    const queryFn = vi.fn().mockResolvedValue([
      { shop_name: "Acme Auto", owner_email: "owner@shop.com" },
    ]);
    await expect(
      sendWelcomeEmailForProvisionedTenant(
        TENANT_ID,
        "+15125551234",
        queryFn as any,
      ),
    ).resolves.toBeUndefined();
  });
});
