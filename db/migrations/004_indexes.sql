-- 004_indexes.sql

BEGIN;

-- Tenant lookups
CREATE INDEX idx_tenants_stripe_customer    ON tenants(stripe_customer_id);
CREATE INDEX idx_tenants_billing_status     ON tenants(billing_status);
CREATE INDEX idx_tenants_owner_email        ON tenants(owner_email);

-- Phone number → tenant routing (hot path: every inbound SMS/call)
CREATE UNIQUE INDEX idx_phone_numbers_number ON tenant_phone_numbers(phone_number)
  WHERE status = 'active';
CREATE INDEX idx_phone_numbers_tenant        ON tenant_phone_numbers(tenant_id);

-- Open conversation lookup (hot path: every inbound message)
CREATE INDEX idx_conversations_open
  ON conversations(tenant_id, customer_phone)
  WHERE status = 'open';

-- Stale conversation sweep (cron job every 15 min)
CREATE INDEX idx_conversations_stale
  ON conversations(last_message_at)
  WHERE status = 'open';

-- Message lookups
CREATE INDEX idx_messages_conversation  ON messages(conversation_id);
CREATE INDEX idx_messages_twilio_sid    ON messages(twilio_sid);
CREATE INDEX idx_messages_tenant        ON messages(tenant_id, sent_at DESC);

-- Appointment lookups
CREATE INDEX idx_appointments_tenant_date ON appointments(tenant_id, scheduled_at);
CREATE INDEX idx_appointments_conversation ON appointments(conversation_id);

-- Billing events dedup
CREATE UNIQUE INDEX idx_billing_events_stripe_id ON billing_events(stripe_event_id);
CREATE INDEX idx_billing_events_tenant ON billing_events(tenant_id, processed_at DESC);

-- System prompts
CREATE INDEX idx_system_prompts_active
  ON system_prompts(tenant_id)
  WHERE is_active = TRUE;

COMMIT;
