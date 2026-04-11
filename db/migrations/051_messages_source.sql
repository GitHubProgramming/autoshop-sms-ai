-- 051_messages_source.sql
-- Add an optional `source` tag to messages so the LT pilot can distinguish
-- zadarma-missed-call outbound SMS from the main SMS AI conversation flow,
-- and so the /internal/lt-recent-conversations read endpoint can surface it.
--
-- Small additive change — nullable, no backfill needed. Existing inserts
-- continue to work unchanged.

BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Partial index: only rows that actually carry a source tag.
-- Keeps the index small since most messages will stay NULL for now.
CREATE INDEX IF NOT EXISTS idx_messages_source
  ON messages (source)
  WHERE source IS NOT NULL;

COMMIT;
