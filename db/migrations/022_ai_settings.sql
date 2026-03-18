-- Migration 022: Add structured AI settings JSONB column to tenants
--
-- Stores the toggle-driven booking configuration from the AI Settings panel.
-- JSONB allows flexible schema evolution without new migrations for each toggle.
-- Default NULL means "use system defaults" (backward-compatible).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_settings JSONB;

COMMENT ON COLUMN tenants.ai_settings IS 'Structured AI behavior settings from the dashboard toggle panel. NULL = system defaults.';
