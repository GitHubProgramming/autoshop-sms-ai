-- 009_appointments_conversation_unique.sql
-- Required for WF-002 ON CONFLICT (conversation_id) DO UPDATE to work.
-- Without this constraint, Postgres rejects the upsert.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_conversation_unique
  ON appointments(conversation_id);

COMMIT;
