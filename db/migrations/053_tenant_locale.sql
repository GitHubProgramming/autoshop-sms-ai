-- 053_tenant_locale.sql
-- Adds locale and currency columns to tenants table for LT pilot localization.
-- Defaults preserve existing USA tenant behavior (en-US / USD).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Check constraints (idempotent: only add if not already present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_locale_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_locale_check
      CHECK (locale IN ('en-US', 'lt-LT'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_currency_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_currency_check
      CHECK (currency IN ('USD', 'EUR'));
  END IF;
END $$;

-- Set LT pilot tenant to Lithuanian locale
UPDATE tenants
  SET locale = 'lt-LT', currency = 'EUR'
  WHERE id = '7d82ab25-e991-4d13-b4ac-846865f8b85a'
    AND locale = 'en-US';  -- only update if still default (idempotent)
