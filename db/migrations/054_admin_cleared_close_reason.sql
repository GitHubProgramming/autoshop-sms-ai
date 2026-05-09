-- Migration 054: allow 'admin_cleared' as a conversations.close_reason value
--
-- The admin cooldown-clear endpoint (PR #520) closes any open
-- conversations for a (tenant, customer) pair so the next inbound
-- event opens a fresh thread. It writes close_reason='admin_cleared'
-- for audit clarity, but the original CHECK constraint from
-- 001_init.sql does not include that value, causing a 23514 error.
--
-- This migration drops the existing CHECK and re-adds it with
-- 'admin_cleared' included.
--
-- Idempotent: drop-if-exists then add.

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_close_reason_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_close_reason_check
  CHECK (close_reason IN (
    'booking_completed',
    'user_closed',
    'inactivity_24h',
    'system_blocked',
    'turn_limit',
    'admin_cleared'
  ));
