export const TRIAL_DAYS = 14;
export const TRIAL_MAX_CONVERSATIONS = 50;
export const DEFAULT_MAX_AI_TURNS = 12;
export const CIRCUIT_BREAKER_MSG_COUNT = 20;
export const CIRCUIT_BREAKER_WINDOW_MINUTES = 10;
export const CIRCUIT_BREAKER_QUARANTINE_HOURS = 1;

export const PLAN_LIMITS = {
  starter:  150,
  pro:      400,
  premium:  1000,
} as const;

export const QUEUE_NAMES = {
  SMS_SEND:      'sms_send',
  AI_PROCESS:    'ai_process',
  CALENDAR_SYNC: 'calendar_sync',
  CRON_TASKS:    'cron_tasks',
} as const;

export const BILLING_STATES_BLOCKED = ['trial_expired', 'suspended', 'canceled'] as const;
export const BILLING_STATES_ACTIVE  = ['trial', 'active', 'past_due'] as const;

export const CLOSE_TRIGGERS = ['stop', 'done', 'cancel', 'quit', 'bye', 'no thanks'] as const;
