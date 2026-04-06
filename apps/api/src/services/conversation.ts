/**
 * Conversation Opening Service — Race-Condition-Safe
 *
 * Ensures exactly one conversation is opened per tenant+phone at a time.
 *
 * Protections:
 *   1. Redis SETNX mutex — prevents two concurrent webhooks from creating
 *      duplicate conversations for the same tenant+phone
 *   2. PostgreSQL FOR UPDATE — locks the tenant row during count check + increment
 *   3. Webhook dedup (handled upstream in webhook handler, not here)
 *
 * Counting happens at OPEN time, not close time. This prevents trial users
 * from opening unlimited conversations before any get counted.
 */

import { PoolClient } from "pg";
import { withTransaction, query } from "../db/client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenConversationResult {
  blocked: boolean;
  reason?: "trial_expired" | "trial_limit" | "suspended" | "canceled" | "paused" | "demo" | "cooldown";
  existing: boolean;
  conversationId: string | null;
  isNew: boolean;
}

interface TenantRow {
  id: string;
  billing_status: string;
  conv_used_this_cycle: number;
  conv_limit_this_cycle: number;
  trial_ends_at: string | null;
  warned_80pct: boolean;
  warned_100pct: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LOCK_TTL_SECONDS = 30;
const DEDUP_WINDOW_HOURS = 24;

// ── Core function ────────────────────────────────────────────────────────────

/**
 * Open (or return existing) conversation for a tenant+phone pair.
 *
 * Flow:
 *   1. Redis SETNX mutex (30s TTL) — prevents concurrent duplicate opens
 *   2. Check for existing open conversation (24h dedup window)
 *   3. Lock tenant row with FOR UPDATE
 *   4. Enforcement: trial blocked at limit/expiry, suspended/canceled blocked
 *   5. Increment conv_used_this_cycle atomically
 *   6. Insert conversation with counted=true
 *   7. Check warning thresholds (non-blocking)
 *
 * IMPORTANT: active/past_due users are NEVER blocked by usage count.
 */
export async function openConversation(
  tenantId: string,
  customerPhone: string
): Promise<OpenConversationResult> {
  // 1. Redis SETNX mutex — prevent concurrent duplicate opens
  // Lazy import: avoids REDIS_URL check at module evaluation time (breaks tests)
  const { redis } = await import("../queues/redis");
  const lockKey = `conv_lock:${tenantId}:${customerPhone}`;
  let lockAcquired = false;

  try {
    const lock = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");
    lockAcquired = lock === "OK";
  } catch {
    // Redis down — fall through without lock (DB FOR UPDATE is the primary guard)
    lockAcquired = true; // Pretend we got it; DB lock is the safety net
  }

  if (!lockAcquired) {
    // Another request is in flight for this tenant+phone.
    // Return a non-blocking "existing" signal — the other request will create it.
    // The caller should retry or find the conversation after a short delay.
    return { blocked: false, existing: true, conversationId: null, isNew: false };
  }

  try {
    return await withTransaction(async (client: PoolClient) => {
      // 2. Check for existing open conversation (24h dedup window)
      const existingResult = await client.query(
        `SELECT id FROM conversations
         WHERE tenant_id = $1
           AND customer_phone = $2
           AND status = 'open'
           AND opened_at > NOW() - INTERVAL '24 hours'
         ORDER BY opened_at DESC
         LIMIT 1`,
        [tenantId, customerPhone]
      );

      if (existingResult.rows[0]) {
        return {
          blocked: false,
          existing: true,
          conversationId: existingResult.rows[0].id as string,
          isNew: false,
        };
      }

      // 2b. Check cooldown (anti-abuse: 1h after close)
      const cooldownResult = await client.query(
        `SELECT cooldown_until FROM conversation_cooldowns
         WHERE tenant_id = $1 AND customer_phone = $2`,
        [tenantId, customerPhone]
      );

      if (cooldownResult.rows[0]) {
        const cooldownUntil = new Date(cooldownResult.rows[0].cooldown_until);
        if (cooldownUntil > new Date()) {
          return {
            blocked: true,
            reason: "cooldown" as const,
            existing: false,
            conversationId: null,
            isNew: false,
          };
        }
      }

      // 3. Lock tenant row — prevents race condition on count
      const tenantResult = await client.query(
        `SELECT id, billing_status, conv_used_this_cycle, conv_limit_this_cycle,
                trial_ends_at, warned_80pct, warned_100pct
         FROM tenants
         WHERE id = $1
         FOR UPDATE`,
        [tenantId]
      );

      if (tenantResult.rows.length === 0) {
        return { blocked: true, reason: "canceled" as const, existing: false, conversationId: null, isNew: false };
      }

      const t = tenantResult.rows[0] as TenantRow;

      // 4. Enforcement — SEPARATE logic for trial vs paid
      if (t.billing_status === "trial" || t.billing_status === "trial_expired") {
        const trialExpired = t.trial_ends_at && new Date() > new Date(t.trial_ends_at);
        const limitHit = t.conv_used_this_cycle >= t.conv_limit_this_cycle;
        if (trialExpired) {
          return { blocked: true, reason: "trial_expired", existing: false, conversationId: null, isNew: false };
        }
        if (limitHit) {
          return { blocked: true, reason: "trial_limit", existing: false, conversationId: null, isNew: false };
        }
      } else if (t.billing_status === "suspended" || t.billing_status === "canceled") {
        return { blocked: true, reason: t.billing_status as "suspended" | "canceled", existing: false, conversationId: null, isNew: false };
      } else if (t.billing_status === "paused") {
        return { blocked: true, reason: "paused", existing: false, conversationId: null, isNew: false };
      } else if (t.billing_status === "past_due_blocked") {
        return { blocked: true, reason: "suspended", existing: false, conversationId: null, isNew: false };
      } else if (t.billing_status === "demo") {
        return { blocked: true, reason: "demo", existing: false, conversationId: null, isNew: false };
      }
      // IMPORTANT: active/past_due/scheduled_cancel users are NEVER blocked by usage count

      // 5. Increment count atomically (row is locked by FOR UPDATE)
      await client.query(
        `UPDATE tenants
         SET conv_used_this_cycle = conv_used_this_cycle + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [tenantId]
      );

      // 6. Insert conversation with counted = true
      const convResult = await client.query(
        `INSERT INTO conversations (tenant_id, customer_phone, status, counted, opened_at, last_message_at)
         VALUES ($1, $2, 'open', TRUE, NOW(), NOW())
         RETURNING id`,
        [tenantId, customerPhone]
      );

      const conversationId = convResult.rows[0].id as string;

      // 7. Check warning thresholds (80% / 100%) — do NOT block, only flag
      const newCount = t.conv_used_this_cycle + 1;
      const limit = t.conv_limit_this_cycle;
      if (limit > 0) {
        const pct = newCount / limit;
        if (pct >= 1.0 && !t.warned_100pct) {
          await client.query(
            `UPDATE tenants SET warned_100pct = TRUE, updated_at = NOW()
             WHERE id = $1 AND warned_100pct = FALSE`,
            [tenantId]
          );
        } else if (pct >= 0.8 && !t.warned_80pct) {
          await client.query(
            `UPDATE tenants SET warned_80pct = TRUE, updated_at = NOW()
             WHERE id = $1 AND warned_80pct = FALSE`,
            [tenantId]
          );
        }
      }

      return {
        blocked: false,
        existing: false,
        conversationId,
        isNew: true,
      };
    });
  } finally {
    // Always release Redis lock
    try {
      await redis.del(lockKey);
    } catch {
      // Non-fatal: lock will expire via TTL
    }
  }
}

// ── Retry wrapper ───────────────────────────────────────────────────────────

const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 500;

/**
 * Opens a conversation with retry logic for Redis lock contention.
 *
 * When openConversation() returns { conversationId: null } because
 * another request holds the Redis SETNX lock, this wrapper retries
 * up to 3 times with 500ms delay. After retries, falls back to a
 * direct DB lookup for the open conversation.
 */
export async function openConversationWithRetry(
  tenantId: string,
  customerPhone: string
): Promise<OpenConversationResult> {
  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    const result = await openConversation(tenantId, customerPhone);

    // Success or definitive block — return immediately
    if (result.blocked) return result;
    if (result.conversationId) return result;

    // Lock contention (null conversationId) — wait and retry
    if (attempt < LOCK_RETRY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }

  // Retries exhausted — try to find existing open conversation directly from DB.
  // The lock holder should have created/found the conversation by now.
  const rows = await query<{ id: string }>(
    `SELECT id FROM conversations
     WHERE tenant_id = $1
       AND customer_phone = $2
       AND status = 'open'
       AND opened_at > NOW() - INTERVAL '24 hours'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [tenantId, customerPhone]
  );

  if (rows.length > 0) {
    return {
      blocked: false,
      existing: true,
      conversationId: rows[0].id,
      isNew: false,
    };
  }

  // Nothing found after retries + DB fallback
  return {
    blocked: false,
    existing: false,
    conversationId: null,
    isNew: false,
  };
}
