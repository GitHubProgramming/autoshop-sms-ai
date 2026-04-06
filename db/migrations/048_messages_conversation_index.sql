-- 048_messages_conversation_index.sql
-- Add index on messages.conversation_id for conversation detail views
-- and SMS dedup checks. These queries run on every conversation page load
-- and every AI SMS reply.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, sent_at ASC);

COMMIT;
