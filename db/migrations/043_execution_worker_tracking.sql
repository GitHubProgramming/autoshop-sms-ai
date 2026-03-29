-- Execution worker tracking columns for dev_loop_tasks
-- Tracks real git execution results: commit SHA, push status, timing

ALTER TABLE dev_loop_tasks
  ADD COLUMN IF NOT EXISTS execution_status TEXT,         -- success | failed | safety_abort
  ADD COLUMN IF NOT EXISTS commit_sha       TEXT,
  ADD COLUMN IF NOT EXISTS push_status      TEXT,         -- pushed | push_failed | skipped
  ADD COLUMN IF NOT EXISTS execution_error  TEXT,
  ADD COLUMN IF NOT EXISTS execution_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dev_loop_tasks_execution
  ON dev_loop_tasks(execution_status)
  WHERE execution_status IS NOT NULL;
