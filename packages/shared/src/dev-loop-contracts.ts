/**
 * Autonomous Dev-Loop Contracts
 *
 * Machine-readable types for the task → execution → review pipeline.
 * Used by n8n workflows and any future API endpoints.
 */

// ─── Task Contract ───────────────────────────────────────────────

export interface TaskContract {
  task_id: string;
  title: string;
  goal: string;
  scope_boundaries: string[];
  files_allowed: string[];
  files_forbidden: string[];
  critical_systems_risk: boolean;
  expected_output: string[];
  checks_required: string[];
}

// ─── Execution Result Contract ───────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'not_run';
export type ExecutionStatus = 'done' | 'failed' | 'blocked';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
}

export interface ExecutionResultContract {
  task_id: string;
  status: ExecutionStatus;
  files_changed: string[];
  checks_run: CheckResult[];
  critical_files_touched: string[];
  summary: string;
  open_issues: string[];
  retry_recommended: boolean;
}

// ─── Review Packet Contract ──────────────────────────────────────

export type GoalMatch = 'full' | 'partial' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Decision = 'SAFE_AUTOMERGE' | 'FIX_AND_RETRY' | 'ESCALATE';

export interface ReviewPacketContract {
  task_id: string;
  review_ready: boolean;
  goal_match: GoalMatch;
  risk_level: RiskLevel;
  critical_systems_touched: boolean;
  checks_passed: boolean;
  logical_gaps: string[];
  recommended_decision: Decision;
  operator_notes: string;
  retry_count: number;
  git_diff_summary: string;
  branch: string;
}

// ─── Critical Systems List ───────────────────────────────────────

export const CRITICAL_SYSTEM_PATTERNS: string[] = [
  '**/stripe**',
  '**/billing**',
  '**/auth**',
  '**/login**',
  '**/session**',
  '**/twilio**',
  '**/google-oauth**',
  '**/token-refresh**',
  '**/rls**',
  '**/provisioning**',
  '**/signup**',
  '**/deploy**',
  '**/migration**',
];

// ─── Execution Worker Contracts ─────────────────────────────────

export interface ExecutionRequest {
  task_id: string;
  title: string;
  goal: string;
  files_to_create: FileChange[];
  files_to_modify: FileChange[];
  files_to_delete: string[];
  commit_message: string;
}

export interface FileChange {
  path: string;
  content: string;
}

export type ExecutionPushStatus = 'pushed' | 'push_failed' | 'skipped';
export type WorkerExecutionStatus = 'success' | 'failed' | 'safety_abort';

export interface ExecutionWorkerResult {
  task_id: string;
  branch: string;
  execution_status: WorkerExecutionStatus;
  files_changed: string[];
  commit_sha: string | null;
  push_status: ExecutionPushStatus;
  error_reason: string | null;
  started_at: string;
  completed_at: string;
}

// File path substrings that flag critical-system risk
export const CRITICAL_PATH_KEYWORDS: string[] = [
  'stripe',
  'billing',
  'auth',
  'login',
  'session',
  'twilio',
  'oauth',
  'token',
  'rls',
  'provisioning',
  'signup',
  'deploy',
  'migration',
];
