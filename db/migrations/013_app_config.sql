-- App configuration table for runtime secrets that can be set via API.
-- Used as fallback when env vars are not available (e.g., Render Dashboard not configured).
-- Keys are unique; updates overwrite.

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
