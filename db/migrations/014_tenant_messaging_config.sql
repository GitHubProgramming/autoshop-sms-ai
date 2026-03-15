-- Migration 014: Add pilot-shop messaging configuration fields to tenants
--
-- Adds per-tenant configurable messaging fields:
--   missed_call_sms_template  — the first SMS sent after a missed call
--   business_hours            — shop hours for AI context
--   services_description      — services offered for AI context
--
-- ai_system_prompt is already handled by the system_prompts table.
-- shop_name already exists on tenants.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS missed_call_sms_template TEXT,
  ADD COLUMN IF NOT EXISTS business_hours TEXT,
  ADD COLUMN IF NOT EXISTS services_description TEXT;

COMMENT ON COLUMN tenants.missed_call_sms_template IS 'Custom SMS template for missed calls. Supports {shop_name} placeholder. Falls back to default if NULL.';
COMMENT ON COLUMN tenants.business_hours IS 'Human-readable business hours, injected into AI system prompt context.';
COMMENT ON COLUMN tenants.services_description IS 'Description of services offered, injected into AI system prompt context.';
