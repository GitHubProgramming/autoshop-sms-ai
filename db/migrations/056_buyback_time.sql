-- Migration 056: Dan Martell "Buy Back Your Time" Calendar App
--
-- Standalone personal productivity system based on Dan Martell's
-- Perfect Week, DRIP Matrix, and Time & Energy Audit frameworks.
-- Independent from the autoshop tenant system — uses its own user table.

BEGIN;

-- Standalone users (not tied to tenants)
CREATE TABLE buyback_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Vilnius',
  annual_income   NUMERIC(12,2),
  buyback_rate    NUMERIC(8,2) GENERATED ALWAYS AS (annual_income / 2000.0 / 4.0) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Perfect Week template blocks
CREATE TABLE perfect_week_blocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES buyback_users(id) ON DELETE CASCADE,
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('deep_work','people','admin','protected')),
  label           TEXT NOT NULL,
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);
CREATE INDEX idx_pw_blocks_user ON perfect_week_blocks(user_id, day_of_week);

-- Daily schedule entries (generated from template or manual)
CREATE TABLE daily_schedule_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES buyback_users(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('deep_work','people','admin','protected')),
  label           TEXT NOT NULL,
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  source          TEXT NOT NULL DEFAULT 'template' CHECK (source IN ('template','manual','calendar')),
  pw_block_id     UUID REFERENCES perfect_week_blocks(id) ON DELETE SET NULL,
  google_event_id TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_daily_user_date ON daily_schedule_entries(user_id, entry_date);

-- DRIP Matrix tasks
CREATE TABLE drip_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES buyback_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  quadrant        TEXT NOT NULL CHECK (quadrant IN ('delegation','replacement','investment','production')),
  money_value     TEXT NOT NULL CHECK (money_value IN ('high','low')),
  energy_impact   TEXT NOT NULL CHECK (energy_impact IN ('high','low')),
  est_hours_week  NUMERIC(4,1),
  hourly_cost     NUMERIC(8,2),
  is_delegated    BOOLEAN NOT NULL DEFAULT FALSE,
  delegated_to    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drip_user ON drip_tasks(user_id, quadrant);

-- Time & Energy Audit entries (15-min increments)
CREATE TABLE time_audit_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES buyback_users(id) ON DELETE CASCADE,
  audit_date      DATE NOT NULL,
  time_slot       TIME NOT NULL,
  activity        TEXT NOT NULL,
  value_rating    SMALLINT NOT NULL CHECK (value_rating BETWEEN 1 AND 4),
  energy_level    TEXT NOT NULL CHECK (energy_level IN ('energizing','neutral','draining')),
  quadrant        TEXT CHECK (quadrant IN ('delegation','replacement','investment','production')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_user_date ON time_audit_entries(user_id, audit_date);

-- Daily adherence tracking for streaks
CREATE TABLE buyback_streaks (
  user_id         UUID NOT NULL REFERENCES buyback_users(id) ON DELETE CASCADE,
  streak_date     DATE NOT NULL,
  total_blocks    SMALLINT NOT NULL DEFAULT 0,
  completed_blocks SMALLINT NOT NULL DEFAULT 0,
  adherence_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, streak_date)
);

-- Google Calendar tokens for buyback users
CREATE TABLE buyback_calendar_tokens (
  user_id         UUID PRIMARY KEY REFERENCES buyback_users(id) ON DELETE CASCADE,
  calendar_id     TEXT NOT NULL,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  token_expiry    TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
