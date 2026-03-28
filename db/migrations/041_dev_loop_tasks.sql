-- Dev-loop task tracking for operator visibility
-- Stores task submissions, execution results, and review decisions

CREATE TABLE IF NOT EXISTS dev_loop_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  goal            TEXT NOT NULL,
  scope_boundaries TEXT[],
  files_allowed   TEXT[],
  files_forbidden TEXT[],
  critical_systems_risk BOOLEAN NOT NULL DEFAULT FALSE,
  expected_output TEXT[],
  checks_required TEXT[],

  -- execution result
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed | blocked
  files_changed   TEXT[],
  checks_run      JSONB,
  critical_files_touched TEXT[],
  execution_summary TEXT,
  open_issues     TEXT[],
  retry_recommended BOOLEAN,

  -- review packet
  goal_match      TEXT,      -- full | partial | failed
  risk_level      TEXT,      -- low | medium | high
  review_decision TEXT,      -- SAFE_AUTOMERGE | FIX_AND_RETRY | ESCALATE
  operator_notes  TEXT,
  branch          TEXT,
  git_diff_summary TEXT,
  retry_count     INT NOT NULL DEFAULT 0,
  logical_gaps    TEXT[],

  -- operator review
  reviewed        BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT,
  review_action   TEXT,      -- operator's chosen action: approve | reject | retry | escalate
  review_comment  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_loop_tasks_status ON dev_loop_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dev_loop_tasks_review ON dev_loop_tasks(reviewed, review_decision);
