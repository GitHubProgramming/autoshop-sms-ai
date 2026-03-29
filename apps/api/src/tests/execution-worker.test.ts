import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockExecuteTask = vi.fn();
const mockValidateExecutionRequest = vi.fn();

vi.mock("../services/execution-worker", () => ({
  executeTask: (...args: unknown[]) => mockExecuteTask(...args),
  validateExecutionRequest: (...args: unknown[]) =>
    mockValidateExecutionRequest(...args),
}));

const mockUpdateTaskResult = vi.fn();

vi.mock("../services/dev-loop-tasks", () => ({
  updateTaskResult: (...args: unknown[]) => mockUpdateTaskResult(...args),
}));

vi.mock("../db/client", () => ({
  db: { end: vi.fn() },
  query: vi.fn(),
}));

import { devLoopExecuteRoute } from "../routes/internal/dev-loop-execute";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(devLoopExecuteRoute, { prefix: "/internal" });
  return app;
}

function internalHeaders() {
  return { "x-internal-key": "test-key" };
}

const VALID_REQUEST = {
  task_id: "test-001",
  title: "Add utility function",
  goal: "Create a helper for date formatting",
  files_to_create: [{ path: "src/utils/date.ts", content: "export const fmt = (d: Date) => d.toISOString();" }],
  files_to_modify: [],
  files_to_delete: [],
  commit_message: "feat: add date utility",
};

const SUCCESS_RESULT = {
  task_id: "test-001",
  branch: "ai/task-test-001",
  execution_status: "success",
  files_changed: ["src/utils/date.ts"],
  commit_sha: "abc123def456",
  push_status: "pushed",
  error_reason: null,
  started_at: "2026-03-29T10:00:00.000Z",
  completed_at: "2026-03-29T10:00:05.000Z",
};

const SAFETY_ABORT_RESULT = {
  task_id: "test-001",
  branch: "ai/task-test-001",
  execution_status: "safety_abort",
  files_changed: [],
  commit_sha: null,
  push_status: "skipped",
  error_reason: "Repository has uncommitted changes — aborting for safety",
  started_at: "2026-03-29T10:00:00.000Z",
  completed_at: "2026-03-29T10:00:01.000Z",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /internal/dev-loop/execute", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.INTERNAL_API_KEY = "test-key";
  });

  it("returns 400 on invalid request body", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: false,
      errors: ["task_id is required and must be a string"],
    });

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toContain("task_id is required and must be a string");
  });

  it("returns 200 with success result on clean execution", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(SUCCESS_RESULT);
    mockUpdateTaskResult.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task_id).toBe("test-001");
    expect(body.branch).toBe("ai/task-test-001");
    expect(body.execution_status).toBe("success");
    expect(body.commit_sha).toBe("abc123def456");
    expect(body.push_status).toBe("pushed");
    expect(body.error_reason).toBeNull();
  });

  it("returns 422 on safety abort (dirty repo)", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(SAFETY_ABORT_RESULT);
    mockUpdateTaskResult.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.execution_status).toBe("safety_abort");
    expect(body.error_reason).toContain("uncommitted changes");
    expect(body.push_status).toBe("skipped");
  });

  it("persists result to dev_loop_tasks", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(SUCCESS_RESULT);
    mockUpdateTaskResult.mockResolvedValue(true);

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    expect(mockUpdateTaskResult).toHaveBeenCalledWith({
      task_id: "test-001",
      status: "done",
      files_changed: ["src/utils/date.ts"],
      execution_summary: expect.stringContaining("ai/task-test-001"),
      branch: "ai/task-test-001",
    });
  });

  it("still returns result if DB persist fails", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(SUCCESS_RESULT);
    mockUpdateTaskResult.mockRejectedValue(new Error("DB connection lost"));

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    // Should still return success — DB persist is non-fatal
    expect(res.statusCode).toBe(200);
    expect(res.json().execution_status).toBe("success");
  });

  it("returns 403 without valid internal key", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: { "x-internal-key": "wrong-key" },
      payload: VALID_REQUEST,
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns structured result with all required fields", async () => {
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(SUCCESS_RESULT);
    mockUpdateTaskResult.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    const body = res.json();
    const requiredFields = [
      "task_id",
      "branch",
      "execution_status",
      "files_changed",
      "commit_sha",
      "push_status",
      "error_reason",
      "started_at",
      "completed_at",
    ];
    for (const field of requiredFields) {
      expect(body).toHaveProperty(field);
    }
  });

  it("returns 422 on push failure", async () => {
    const pushFailResult = {
      ...SUCCESS_RESULT,
      execution_status: "failed",
      push_status: "push_failed",
      error_reason: "Push failed: permission denied",
    };
    mockValidateExecutionRequest.mockReturnValue({
      valid: true,
      errors: [],
      data: VALID_REQUEST,
    });
    mockExecuteTask.mockResolvedValue(pushFailResult);
    mockUpdateTaskResult.mockResolvedValue(true);

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/dev-loop/execute",
      headers: internalHeaders(),
      payload: VALID_REQUEST,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().push_status).toBe("push_failed");
  });
});

describe("validateExecutionRequest", () => {
  // Import the real validation function (not mocked)
  let validateExecutionRequest: typeof import("../services/execution-worker").validateExecutionRequest;

  beforeEach(async () => {
    vi.doUnmock("../services/execution-worker");
    const mod = await import("../services/execution-worker");
    validateExecutionRequest = mod.validateExecutionRequest;
  });

  it("accepts valid request", () => {
    const result = validateExecutionRequest(VALID_REQUEST);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toBeDefined();
  });

  it("rejects missing task_id", () => {
    const { task_id, ...rest } = VALID_REQUEST;
    const result = validateExecutionRequest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("task_id is required and must be a string");
  });

  it("rejects missing commit_message", () => {
    const { commit_message, ...rest } = VALID_REQUEST;
    const result = validateExecutionRequest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "commit_message is required and must be a string"
    );
  });

  it("rejects path traversal in file creates", () => {
    const req = {
      ...VALID_REQUEST,
      files_to_create: [{ path: "../../../etc/passwd", content: "hack" }],
    };
    const result = validateExecutionRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("traversal"))).toBe(true);
  });

  it("rejects absolute paths in file creates", () => {
    const req = {
      ...VALID_REQUEST,
      files_to_create: [{ path: "/etc/passwd", content: "hack" }],
    };
    const result = validateExecutionRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("traversal or absolute"))).toBe(
      true
    );
  });

  it("rejects path traversal in deletes", () => {
    const req = {
      ...VALID_REQUEST,
      files_to_delete: ["../../important-file.txt"],
    };
    const result = validateExecutionRequest(req);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("traversal"))).toBe(true);
  });

  it("rejects non-object body", () => {
    const result = validateExecutionRequest(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Request body must be an object");
  });

  it("rejects file changes without content", () => {
    const req = {
      ...VALID_REQUEST,
      files_to_create: [{ path: "file.ts" }],
    };
    const result = validateExecutionRequest(req);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e: string) => e.includes("string 'content'"))
    ).toBe(true);
  });
});
