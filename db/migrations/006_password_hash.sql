-- Migration 006: Add password_hash column to tenants
-- Required for real password authentication (I4)
-- Existing rows: NULL = pilot-mode (any email can login until password is set via reset flow)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_hash TEXT;
