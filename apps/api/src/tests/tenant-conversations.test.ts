import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: mocks.query,
}));

import { tenantConversationsRoute } from "../routes/tenant/conversations";

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CONV_ID = "11111111-1111-1111-1111-111111111111";
const EMAIL = "owner@shop.com";
const JWT_SECRET = "test-secret";

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(tenantConversationsRoute, { prefix: "/tenant" });
  return app;
}

function makeToken(app: ReturnType<typeof Fastify>) {
  return (app as any).jwt.sign({ tenantId: TENANT_ID, email: EMAIL });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /tenant/conversations/:id
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /tenant/conversations/:id", () => {
  it("returns conversation with messages for authenticated tenant", async () => {
    const conv = {
      id: CONV_ID,
      tenant_id: TENANT_ID,
      customer_phone: "+15551234567",
      status: "open",
      turn_count: 3,
      opened_at: "2026-03-18T10:00:00Z",
      last_message_at: "2026-03-18T10:05:00Z",
      closed_at: null,
      close_reason: null,
    };
    const messages = [
      { id: "m1", direction: "outbound", body: "Hello!", sent_at: "2026-03-18T10:00:00Z" },
      { id: "m2", direction: "inbound", body: "Hi, I need service", sent_at: "2026-03-18T10:01:00Z" },
      { id: "m3", direction: "outbound", body: "Sure, when works?", sent_at: "2026-03-18T10:02:00Z" },
    ];

    mocks.query
      .mockResolvedValueOnce([conv])     // conversation query
      .mockResolvedValueOnce(messages);   // messages query

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "GET",
      url: `/tenant/conversations/${CONV_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversation.id).toBe(CONV_ID);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].direction).toBe("outbound");
    expect(body.messages[1].body).toBe("Hi, I need service");
  });

  it("returns 404 when conversation does not exist or belongs to another tenant", async () => {
    mocks.query
      .mockResolvedValueOnce([])    // conversation not found (tenant_id filter)
      .mockResolvedValueOnce([]);   // messages (empty)

    const app = await buildApp();
    const token = makeToken(app);

    const res = await app.inject({
      method: "GET",
      url: `/tenant/conversations/${CONV_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Conversation not found");
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/tenant/conversations/${CONV_ID}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("queries filter by tenant_id to prevent cross-tenant access", async () => {
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    const token = makeToken(app);

    await app.inject({
      method: "GET",
      url: `/tenant/conversations/${CONV_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Both queries should include tenant_id filter
    expect(mocks.query).toHaveBeenCalledTimes(2);
    const convCall = mocks.query.mock.calls[0];
    const msgCall = mocks.query.mock.calls[1];

    // Conversation query filters by id AND tenant_id
    expect(convCall[1]).toEqual([CONV_ID, TENANT_ID]);
    // Messages query filters by conversation_id AND tenant_id
    expect(msgCall[1]).toEqual([CONV_ID, TENANT_ID]);
  });
});
