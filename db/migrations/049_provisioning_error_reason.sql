-- 049_provisioning_error_reason.sql
-- Adds a free-text column to capture *why* provisioning failed so the dashboard
-- and ops can see the reason without grepping logs. Additive, NULL-safe.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS provisioning_error_reason TEXT NULL;
