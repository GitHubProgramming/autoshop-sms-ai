// ============================================================
// AutoShop SMS AI — Conversation Service
// Atomic conversation open, circuit breaker, close logic.
// ALL counting happens here via stored procedure in DB.
// ============================================================

import { query, withTenant, getPool } from '../db/client';
import { Conversation, ConversationTrigger } from '@autoshop/shared';
import { checkUsageWarnings } from './billing';
import Redis from 'ioredis';

let redis: Redis;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return redis;
}

// ──────────────────────────────────────────────────────────
// Circuit Breaker
// Quarantine if >20 messages from same number in 10 minutes
// ──────────────────────────────────────────────────────────
const CIRCUIT_BREAKER_LIMIT = 20;
const CIRCUIT_BREAKER_WINDOW_SECS = 10 * 60; // 10 minutes

export async function checkCircuitBreaker(
  tenantId: string,
  phoneNumber: string
): Promise<boolean> {
  const key = `cb:${tenantId}:${phoneNumber}`;
  const r = getRedis();
  const count = await r.incr(key);
  if (count === 1) {
    await r.expire(key, CIRCUIT_BREAKER_WINDOW_SECS);
  }

  if (count > CIRCUIT_BREAKER_LIMIT) {
    // Log circuit breaker event
    await query(
      `INSERT INTO circuit_breaker_events (tenant_id, phone_number, message_count, window_mins)
       VALUES ($1, $2, $3, 10)`,
      [tenantId, phoneNumber, count]
    );

    // Close any open conversation from this number
    await query(
      `UPDATE conversations
       SET status = 'closed_inactive',
           close_reason = 'circuit_breaker',
           closed_at = NOW(),
           quarantined = TRUE
       WHERE tenant_id = $1
         AND customer_phone = $2
         AND status = 'open'`,
      [tenantId, phoneNumber]
    );

    return true; // blocked
  }
  return false;
}

// ──────────────────────────────────────────────────────────
// Atomic Conversation Open
// Calls stored procedure: open_conversation()
// ──────────────────────────────────────────────────────────
export interface OpenConversationResult {
  conversationId: string | null;
  blocked: boolean;
  blockReason: string | null;
  isExisting: boolean;
}

export async function openConversation(
  tenantId: string,
  customerPhone: string,
  twilioNumber: string,
  triggerType: ConversationTrigger
): Promise<OpenConversationResult> {
  const { rows } = await query<{
    conversation_id: string | null;
    blocked: boolean;
    block_reason: string | null;
  }>(
    `SELECT * FROM open_conversation($1, $2, $3, $4)`,
    [tenantId, customerPhone, twilioNumber, triggerType]
  );

  const row = rows[0];
  if (!row || row.blocked) {
    return {
      conversationId: null,
      blocked: true,
      blockReason: row?.block_reason || 'unknown',
      isExisting: false,
    };
  }

  // Check if this is a new conversation (usage warnings apply)
  // The procedure returns existing conv_id without incrementing if it exists
  const isExisting = false; // stored procedure handles dedup internally
  await checkUsageWarnings(tenantId);

  return {
    conversationId: row.conversation_id!,
    blocked: false,
    blockReason: null,
    isExisting,
  };
}

// ──────────────────────────────────────────────────────────
// Get conversation with tenant enforcement
// ──────────────────────────────────────────────────────────
export async function getConversation(
  tenantId: string,
  conversationId: string
): Promise<Conversation | null> {
  const { rows } = await query<Conversation>(
    `SELECT * FROM conversations
     WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId]
  );
  return rows[0] || null;
}

// ──────────────────────────────────────────────────────────
// Close conversation
// ──────────────────────────────────────────────────────────
export async function closeConversation(
  conversationId: string,
  reason: string
): Promise<void> {
  await query(
    `UPDATE conversations
     SET status = CASE
           WHEN $2 = 'booking_complete' THEN 'completed'
           ELSE 'closed_inactive'
         END,
         close_reason = $2,
         closed_at = NOW()
     WHERE id = $1 AND status = 'open'`,
    [conversationId, reason]
  );
}

// ──────────────────────────────────────────────────────────
// Increment turn count
// ──────────────────────────────────────────────────────────
export async function incrementTurnCount(
  conversationId: string
): Promise<{ turn_count: number; max_turns: number }> {
  const { rows } = await query<{ turn_count: number; max_turns: number }>(
    `UPDATE conversations
     SET turn_count = turn_count + 1,
         last_activity_at = NOW()
     WHERE id = $1
     RETURNING turn_count, max_turns`,
    [conversationId]
  );
  return rows[0] || { turn_count: 0, max_turns: 12 };
}

// ──────────────────────────────────────────────────────────
// Insert message
// ──────────────────────────────────────────────────────────
export async function insertMessage(
  tenantId: string,
  conversationId: string,
  direction: 'inbound' | 'outbound',
  body: string,
  options: { twilioSid?: string; aiModel?: string; tokensUsed?: number } = {}
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO messages (tenant_id, conversation_id, direction, body, twilio_sid, ai_model, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      tenantId,
      conversationId,
      direction,
      body,
      options.twilioSid || null,
      options.aiModel || null,
      options.tokensUsed || null,
    ]
  );
  return rows[0].id;
}

// ──────────────────────────────────────────────────────────
// Close conversations inactive for 24h (cron job target)
// ──────────────────────────────────────────────────────────
export async function closeInactiveConversations(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE conversations
     SET status = 'closed_inactive',
         close_reason = 'inactivity_24h',
         closed_at = NOW()
     WHERE status = 'open'
       AND last_activity_at < NOW() - INTERVAL '24 hours'`
  );
  return rowCount;
}

// ──────────────────────────────────────────────────────────
// Detect close intent in message body
// ──────────────────────────────────────────────────────────
export function detectCloseIntent(body: string): boolean {
  const lower = body.toLowerCase().trim();
  const closeWords = ['stop', 'done', 'cancel', 'quit', 'bye', 'goodbye', 'no thanks', 'never mind'];
  return closeWords.some((w) => lower === w || lower.startsWith(w + ' '));
}
