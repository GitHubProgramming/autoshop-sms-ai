// ─── Billing ─────────────────────────────────────────────────
export type BillingState =
  | 'trial'
  | 'trial_expired'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'canceled';

export type PlanId = 'starter' | 'pro' | 'premium' | 'enterprise';

export const PLAN_LIMITS: Record<Exclude<PlanId,'enterprise'>, number> = {
  starter:  150,
  pro:      400,
  premium:  1000,
};

// ─── Conversations ────────────────────────────────────────────
export type ConversationStatus =
  | 'open'
  | 'completed'
  | 'closed_inactive'
  | 'blocked';

export type CloseReason =
  | 'booking_complete'
  | 'user_explicit'
  | 'inactivity_24h'
  | 'max_turns_reached'
  | 'blocked_trial'
  | 'blocked_plan';

export type TriggerType = 'missed_call' | 'sms_inbound';

// ─── Sync Status ──────────────────────────────────────────────
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'not_connected';

// ─── Queue Job Payloads ───────────────────────────────────────
export interface MissedCallJob {
  type: 'missed_call';
  tenant_id: string;
  caller_phone: string;
  twilio_number: string;
  call_sid: string;
  delay_ms: number;
}

export interface SmsInboundJob {
  type: 'sms_inbound';
  tenant_id: string;
  customer_phone: string;
  twilio_number: string;
  message_body: string;
  message_sid: string;
}

export interface CalendarSyncJob {
  type: 'calendar_sync';
  tenant_id: string;
  appointment_id: string;
}

export interface WarningEmailJob {
  type: 'warning_email';
  tenant_id: string;
  level: '80' | '100';
  usage_count: number;
  usage_limit: number;
}

export type WorkerJob =
  | MissedCallJob
  | SmsInboundJob
  | CalendarSyncJob
  | WarningEmailJob;

// ─── API Response Types ───────────────────────────────────────
export interface HealthResponse {
  twilio_connected: boolean;
  calendar_connected: boolean;
  calendar_last_error: string | null;
  billing_state: BillingState;
  conversations_used: number;
  conversations_limit: number;
  conversations_remaining: number;
  trial_days_left: number | null;
  plan: string;
}

export interface KpiResponse {
  conversations_this_month: number;
  limit: number;
  pct_used: number;
  appointments_booked: number;
  avg_response_time_s: number | null;
}

export interface ConversationListItem {
  id: string;
  customer_phone: string;
  status: ConversationStatus;
  trigger_type: TriggerType;
  turn_count: number;
  opened_at: string;
  last_activity_at: string;
  last_message_preview: string | null;
}

export interface ConversationDetail extends ConversationListItem {
  messages: MessageRecord[];
  appointment: AppointmentRecord | null;
}

export interface MessageRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
}

export interface AppointmentRecord {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  service_type: string | null;
  scheduled_at: string;
  sync_status: SyncStatus;
}

export interface OnboardingStatus {
  shop_profile: boolean;
  number_provisioned: boolean;
  calendar_connected: boolean;
  forwarding_verified: boolean;
}
