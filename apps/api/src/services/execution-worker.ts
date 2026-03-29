/**
 * Execution Worker Service
 *
 * Real git execution layer for approved dev-loop tasks.
 * Receives an approved task payload, creates a branch, applies file changes,
 * commits, and pushes to GitHub. Returns structured execution results.
 *
 * Supports two modes:
 *   1. LOCAL MODE — when EXECUTION_REPO_ROOT points to an existing git checkout
 *   2. CLONE MODE — when no local checkout exists (e.g., Render container),
 *      clones the repo on-demand using GITHUB_TOKEN into a temp directory
 *
 * Required env for clone mode:
 *   GITHUB_TOKEN  — GitHub personal access token with repo scope
 *   GITHUB_REPO   — owner/repo format (e.g., "GitHubProgramming/autoshop-sms-ai")
 *
 * Safety contract:
 *   - Hard-fails if repo is dirty before execution (local mode)
 *   - Hard-fails if push fails
 *   - Hard-fails if no changes produced
 *   - Hard-fails if branch already exists on remote
 *   - Always cleans up temp directories (clone mode)
 *   - Always returns to original branch on completion (local mode)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir, rm } from "fs/promises";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { tmpdir } from "os";

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
  execution_host: string;
  started_at: string;
  completed_at: string;
}

const execFileAsync = promisify(execFile);

// Max execution time for any single git command (60s — clone can be slow)
const GIT_TIMEOUT_MS = 60_000;

// ── Git helpers ────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
  return stdout.trim();
}

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

// ── Clone mode helpers ─────────────────────────────────────────────

function getCloneUrl(): string | null {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return null;
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

async function cloneRepo(cloneUrl: string, targetDir: string): Promise<void> {
  // Shallow clone of main only — fast and minimal
  await execFileAsync("git", [
    "clone", "--depth=1", "--branch=main", "--single-branch",
    cloneUrl, targetDir,
  ], { timeout: GIT_TIMEOUT_MS * 2, maxBuffer: 10 * 1024 * 1024 });

  // Unshallow enough to create branches and push
  // (shallow clone can push new branches fine)
  await git(["config", "user.email", "execution-worker@autoshop-ai.com"], targetDir);
  await git(["config", "user.name", "AutoShop Execution Worker"], targetDir);
}

// ── Detect execution host ──────────────────────────────────────────

function detectHost(): string {
  if (process.env.RENDER) return "render";
  if (process.env.GITHUB_ACTIONS) return "github-actions";
  if (process.env.EXECUTION_REPO_ROOT) return "configured-local";
  return "local";
}

// ── Main execution function ────────────────────────────────────────

export async function executeTask(
  request: ExecutionRequest
): Promise<ExecutionWorkerResult> {
  const startedAt = new Date().toISOString();
  const branchName = `ai/task-${request.task_id}`;
  const host = detectHost();

  const fail = (reason: string, status: WorkerExecutionStatus = "failed"): ExecutionWorkerResult => ({
    task_id: request.task_id,
    branch: branchName,
    execution_status: status,
    files_changed: [],
    commit_sha: null,
    push_status: "skipped",
    error_reason: reason,
    execution_host: host,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });

  // Determine working directory
  const configuredRoot = process.env.EXECUTION_REPO_ROOT || process.cwd();
  const useCloneMode = !isGitRepo(configuredRoot);
  let workDir: string;
  let tempDir: string | null = null;
  let originalBranch: string | null = null;

  if (useCloneMode) {
    // ── Clone mode: no local repo, clone on-demand ──────────
    const cloneUrl = getCloneUrl();
    if (!cloneUrl) {
      return fail(
        "No git repo at working directory and GITHUB_TOKEN/GITHUB_REPO not set — cannot execute",
        "safety_abort"
      );
    }

    tempDir = join(tmpdir(), `exec-worker-${request.task_id}-${Date.now()}`);
    try {
      await mkdir(tempDir, { recursive: true });
      await cloneRepo(cloneUrl, tempDir);
    } catch (err) {
      await cleanupTemp(tempDir);
      return fail(`Failed to clone repo: ${(err as Error).message}`);
    }
    workDir = tempDir;
  } else {
    // ── Local mode: use existing checkout ────────────────────
    workDir = configuredRoot;

    // Safety: check repo is clean
    const status = await git(["status", "--porcelain"], workDir);
    if (status.length > 0) {
      return fail("Repository has uncommitted changes — aborting for safety", "safety_abort");
    }

    originalBranch = await git(["rev-parse", "--abbrev-ref", "HEAD"], workDir);

    // Fetch latest main
    await git(["fetch", "origin", "main"], workDir);
    await git(["checkout", "main"], workDir);
    await git(["reset", "--hard", "origin/main"], workDir);
  }

  try {
    // ── Check branch doesn't already exist on remote ────────
    const lsRemote = await git(["ls-remote", "--heads", "origin", branchName], workDir);
    if (lsRemote.length > 0) {
      return fail(
        `Branch ${branchName} already exists on remote — cannot safely reuse`,
        "safety_abort"
      );
    }

    // In local mode, clean up stale local branch
    if (!useCloneMode) {
      try { await git(["branch", "-D", branchName], workDir); } catch { /* doesn't exist */ }
    }

    // ── Create task branch ──────────────────────────────────
    await git(["checkout", "-b", branchName], workDir);

    // ── Apply file changes ──────────────────────────────────
    const changedFiles: string[] = [];

    for (const file of [...request.files_to_create, ...request.files_to_modify]) {
      const fullPath = join(workDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, "utf-8");
      changedFiles.push(file.path);
    }

    for (const filePath of request.files_to_delete) {
      const fullPath = join(workDir, filePath);
      if (existsSync(fullPath)) {
        await unlink(fullPath);
        changedFiles.push(filePath);
      }
    }

    // ── Check changes were produced ─────────────────────────
    const dirty = await git(["status", "--porcelain"], workDir);
    if (dirty.length === 0) {
      return fail("No changes produced after applying task — nothing to commit", "safety_abort");
    }

    // ── Stage and commit ────────────────────────────────────
    await git(["add", "--all"], workDir);

    const commitMsg = `${request.commit_message}\n\ntask_id: ${request.task_id}\nexecution: automated-worker\nhost: ${host}`;
    await git(["commit", "-m", commitMsg], workDir);

    const commitSha = await git(["rev-parse", "HEAD"], workDir);

    // ── Push to origin ──────────────────────────────────────
    let pushStatus: ExecutionPushStatus = "skipped";
    let pushError: string | null = null;

    try {
      await git(["push", "-u", "origin", branchName], workDir);
      pushStatus = "pushed";
    } catch (err) {
      pushStatus = "push_failed";
      pushError = (err as Error).message;
    }

    if (pushStatus === "push_failed") {
      return {
        task_id: request.task_id,
        branch: branchName,
        execution_status: "failed",
        files_changed: changedFiles,
        commit_sha: commitSha,
        push_status: pushStatus,
        error_reason: `Push failed: ${pushError}`,
        execution_host: host,
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
      execution_host: host,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    };
  } catch (err) {
    return fail(`Unexpected error: ${(err as Error).message}`);
  } finally {
    // Cleanup: restore branch (local) or delete temp dir (clone)
    if (tempDir) {
      await cleanupTemp(tempDir);
    } else if (originalBranch) {
      try {
        await git(["checkout", originalBranch], workDir);
      } catch {
        try { await git(["checkout", "main"], workDir); } catch { /* best-effort */ }
      }
    }
  }
}

async function cleanupTemp(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
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
