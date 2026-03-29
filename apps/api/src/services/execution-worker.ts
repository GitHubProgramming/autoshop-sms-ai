/**
 * Execution Worker Service
 *
 * Real git execution layer for approved dev-loop tasks.
 * Receives an approved task payload, creates a branch, applies file changes,
 * commits, and pushes to GitHub. Returns structured execution results.
 *
 * Safety contract:
 *   - Hard-fails if repo is dirty before execution
 *   - Hard-fails if push fails
 *   - Hard-fails if no changes produced
 *   - Hard-fails if branch already exists and cannot be reused safely
 *   - Always returns to original branch on completion or failure
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { existsSync } from "fs";
// ── Types (mirrored from packages/shared/src/dev-loop-contracts.ts) ──

interface FileChange {
  path: string;
  content: string;
}

export interface ExecutionRequest {
  task_id: string;
  title: string;
  goal: string;
  files_to_create: FileChange[];
  files_to_modify: FileChange[];
  files_to_delete: string[];
  commit_message: string;
}

type ExecutionPushStatus = "pushed" | "push_failed" | "skipped";
type WorkerExecutionStatus = "success" | "failed" | "safety_abort";

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

const execFileAsync = promisify(execFile);

// Repo root — configurable for testing, defaults to process.cwd()
const REPO_ROOT = process.env.EXECUTION_REPO_ROOT || process.cwd();

// Max execution time for any single git command (30s)
const GIT_TIMEOUT_MS = 30_000;

// ── Git helpers ────────────────────────────────────────────────────

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: cwd ?? REPO_ROOT,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
  return stdout.trim();
}

async function isRepoDirty(): Promise<boolean> {
  const status = await git(["status", "--porcelain"]);
  return status.length > 0;
}

async function getCurrentBranch(): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function branchExistsLocally(branch: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", branch]);
    return true;
  } catch {
    return false;
  }
}

async function branchExistsRemotely(branch: string): Promise<boolean> {
  try {
    await git(["ls-remote", "--heads", "origin", branch]);
    const result = await git(["ls-remote", "--heads", "origin", branch]);
    return result.length > 0;
  } catch {
    return false;
  }
}

// ── Main execution function ────────────────────────────────────────

export async function executeTask(
  request: ExecutionRequest
): Promise<ExecutionWorkerResult> {
  const startedAt = new Date().toISOString();
  const branchName = `ai/task-${request.task_id}`;
  let originalBranch: string | null = null;

  const fail = (reason: string, status: WorkerExecutionStatus = "failed"): ExecutionWorkerResult => ({
    task_id: request.task_id,
    branch: branchName,
    execution_status: status,
    files_changed: [],
    commit_sha: null,
    push_status: "skipped",
    error_reason: reason,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });

  try {
    // ── 1. Safety: check repo is clean ──────────────────────
    if (await isRepoDirty()) {
      return fail("Repository has uncommitted changes — aborting for safety", "safety_abort");
    }

    // ── 2. Remember current branch for cleanup ──────────────
    originalBranch = await getCurrentBranch();

    // ── 3. Fetch latest main ────────────────────────────────
    await git(["fetch", "origin", "main"]);
    await git(["checkout", "main"]);
    await git(["reset", "--hard", "origin/main"]);

    // ── 4. Check branch doesn't already exist ───────────────
    const localExists = await branchExistsLocally(branchName);
    const remoteExists = await branchExistsRemotely(branchName);

    if (remoteExists) {
      // Remote branch exists — cannot safely reuse
      await restoreBranch(originalBranch);
      return fail(
        `Branch ${branchName} already exists on remote — cannot safely reuse`,
        "safety_abort"
      );
    }

    if (localExists) {
      // Delete stale local branch (remote doesn't have it)
      await git(["branch", "-D", branchName]);
    }

    // ── 5. Create task branch ───────────────────────────────
    await git(["checkout", "-b", branchName]);

    // ── 6. Apply file changes ───────────────────────────────
    const changedFiles: string[] = [];

    // Create/overwrite files
    for (const file of [...request.files_to_create, ...request.files_to_modify]) {
      const fullPath = join(REPO_ROOT, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, "utf-8");
      changedFiles.push(file.path);
    }

    // Delete files
    for (const filePath of request.files_to_delete) {
      const fullPath = join(REPO_ROOT, filePath);
      if (existsSync(fullPath)) {
        await unlink(fullPath);
        changedFiles.push(filePath);
      }
    }

    // ── 7. Check changes were produced ──────────────────────
    if (!(await isRepoDirty())) {
      await restoreBranch(originalBranch);
      return fail("No changes produced after applying task — nothing to commit", "safety_abort");
    }

    // ── 8. Stage and commit ─────────────────────────────────
    await git(["add", "--all"]);

    const commitMsg = `${request.commit_message}\n\ntask_id: ${request.task_id}\nexecution: automated-worker`;
    await git(["commit", "-m", commitMsg]);

    const commitSha = await git(["rev-parse", "HEAD"]);

    // ── 9. Push to origin ───────────────────────────────────
    let pushStatus: ExecutionPushStatus = "skipped";
    let pushError: string | null = null;

    try {
      await git(["push", "-u", "origin", branchName]);
      pushStatus = "pushed";
    } catch (err) {
      pushStatus = "push_failed";
      pushError = (err as Error).message;
    }

    // ── 10. Return to original branch ───────────────────────
    await restoreBranch(originalBranch);

    if (pushStatus === "push_failed") {
      return {
        task_id: request.task_id,
        branch: branchName,
        execution_status: "failed",
        files_changed: changedFiles,
        commit_sha: commitSha,
        push_status: pushStatus,
        error_reason: `Push failed: ${pushError}`,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };
    }

    return {
      task_id: request.task_id,
      branch: branchName,
      execution_status: "success",
      files_changed: changedFiles,
      commit_sha: commitSha,
      push_status: pushStatus,
      error_reason: null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  } catch (err) {
    // Attempt cleanup
    if (originalBranch) {
      try {
        await restoreBranch(originalBranch);
      } catch {
        // Best-effort cleanup
      }
    }
    return fail(`Unexpected error: ${(err as Error).message}`);
  }
}

async function restoreBranch(branch: string | null): Promise<void> {
  if (!branch) return;
  try {
    await git(["checkout", branch]);
  } catch {
    // If restore fails, try main as fallback
    await git(["checkout", "main"]);
  }
}

// ── Validation ─────────────────────────────────────────────────────

export function validateExecutionRequest(req: unknown): {
  valid: boolean;
  errors: string[];
  data?: ExecutionRequest;
} {
  const errors: string[] = [];
  const r = req as Record<string, unknown>;

  if (!r || typeof r !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }

  if (!r.task_id || typeof r.task_id !== "string") {
    errors.push("task_id is required and must be a string");
  }
  if (!r.title || typeof r.title !== "string") {
    errors.push("title is required and must be a string");
  }
  if (!r.goal || typeof r.goal !== "string") {
    errors.push("goal is required and must be a string");
  }
  if (!r.commit_message || typeof r.commit_message !== "string") {
    errors.push("commit_message is required and must be a string");
  }

  if (!Array.isArray(r.files_to_create)) {
    errors.push("files_to_create must be an array");
  }
  if (!Array.isArray(r.files_to_modify)) {
    errors.push("files_to_modify must be an array");
  }
  if (!Array.isArray(r.files_to_delete)) {
    errors.push("files_to_delete must be an array");
  }

  // Validate file changes have path + content
  for (const arr of [r.files_to_create, r.files_to_modify] as unknown[][]) {
    if (Array.isArray(arr)) {
      for (const f of arr) {
        const file = f as Record<string, unknown>;
        if (!file?.path || typeof file.path !== "string") {
          errors.push("Each file change must have a string 'path'");
        }
        if (file?.content === undefined || typeof file.content !== "string") {
          errors.push("Each file change must have a string 'content'");
        }
        // Block path traversal
        if (typeof file?.path === "string" && (file.path.includes("..") || file.path.startsWith("/"))) {
          errors.push(`Invalid file path (traversal or absolute): ${file.path}`);
        }
      }
    }
  }

  // Block path traversal in deletes
  if (Array.isArray(r.files_to_delete)) {
    for (const p of r.files_to_delete as string[]) {
      if (typeof p === "string" && (p.includes("..") || p.startsWith("/"))) {
        errors.push(`Invalid delete path (traversal or absolute): ${p}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data: r as unknown as ExecutionRequest };
}
