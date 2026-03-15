import { FastifyInstance } from "fastify";
import { readFile, access } from "fs/promises";
import { join, resolve } from "path";
import { createHash } from "crypto";
import { adminGuard } from "../../middleware/admin-guard";

const REPO_STATUS_FILE = join("project-brain", "project_status.json");
const API_LOCAL_FILE = join("project-status", "project_status.json");

const REPO_STATUS_V2_FILE = join("project-brain", "project_status_v2.json");
const API_LOCAL_V2_FILE = join("project-status", "project_status_v2.json");

const REPO_MOVEMENT_LOG = join("project-brain", "movement_log.json");
const API_LOCAL_MOVEMENT_LOG = join("project-status", "movement_log.json");

/**
 * Build an ordered list of candidate paths for a given file.
 * The first accessible path wins.
 *
 * Priority:
 *   1. Env override (if provided)
 *   2. Canonical repo-root project-brain/ (always current in dev and CI)
 *   3. API-local deploy-safe copy (fallback inside container)
 */
function getCandidatePaths(
  repoRelative: string,
  apiLocalRelative: string,
  envOverride?: string,
): string[] {
  const candidates: string[] = [];

  // 1. Explicit env var override (highest priority)
  if (envOverride) {
    candidates.push(resolve(envOverride));
  }

  // 2. Canonical repo-root project-brain/ (always up-to-date in dev and CI)
  candidates.push(resolve(process.cwd(), repoRelative));
  candidates.push(resolve(__dirname, "..", "..", "..", "..", "..", repoRelative));
  candidates.push(resolve(__dirname, "..", "..", "..", repoRelative));

  // 3. API-local deploy-safe copy (fallback inside container where repo root is absent)
  //    In container: /app/project-status/project_status.json
  candidates.push(resolve(process.cwd(), apiLocalRelative));
  candidates.push(resolve(__dirname, "..", "..", "..", apiLocalRelative));

  return candidates;
}

/** Try each candidate path in order; return parsed JSON from the first accessible one. */
async function readFirstAccessible(candidates: string[]): Promise<unknown | null> {
  for (const filePath of candidates) {
    try {
      await access(filePath);
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      // This candidate didn't work — try next
    }
  }
  return null;
}

/** Try each candidate; return the resolved path, raw content, and parsed JSON. */
async function readFirstAccessibleWithMeta(
  candidates: string[],
): Promise<{ path: string; raw: string; data: unknown } | null> {
  for (const filePath of candidates) {
    try {
      await access(filePath);
      const raw = await readFile(filePath, "utf-8");
      return { path: filePath, raw, data: JSON.parse(raw) };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * GET /internal/admin/project-status
 * GET /internal/admin/project-status-v2
 * GET /internal/admin/movement-log
 *
 * Read-only endpoints for the Project Ops dashboard.
 */
export async function projectStatusRoute(app: FastifyInstance) {
  // ── v1 (legacy) ──────────────────────────────────────────────────────────
  app.get("/admin/project-status", { preHandler: [adminGuard] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const candidates = getCandidatePaths(
      REPO_STATUS_FILE,
      API_LOCAL_FILE,
      process.env.PROJECT_STATUS_JSON_PATH,
    );
    const data = await readFirstAccessible(candidates);

    if (data !== null) {
      return reply.status(200).send(data);
    }

    app.log.error(
      { attemptedPaths: candidates },
      "Failed to read project_status.json — none of the candidate paths exist",
    );
    return reply.status(500).send({
      error: "Failed to read project status file",
      detail: `None of the candidate paths were accessible: ${candidates.join(", ")}`,
    });
  });

  // ── v2 ────────────────────────────────────────────────────────────────────
  app.get("/admin/project-status-v2", { preHandler: [adminGuard] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const candidates = getCandidatePaths(
      REPO_STATUS_V2_FILE,
      API_LOCAL_V2_FILE,
      process.env.PROJECT_STATUS_V2_JSON_PATH,
    );
    const data = await readFirstAccessible(candidates);

    if (data !== null) {
      return reply.status(200).send(data);
    }

    app.log.error(
      { attemptedPaths: candidates },
      "Failed to read project_status_v2.json — none of the candidate paths exist",
    );
    return reply.status(500).send({
      error: "Failed to read project status v2 file",
      detail: `None of the candidate paths were accessible: ${candidates.join(", ")}`,
    });
  });

  // ── movement log ──────────────────────────────────────────────────────────
  app.get("/admin/movement-log", { preHandler: [adminGuard] }, async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const candidates = getCandidatePaths(
      REPO_MOVEMENT_LOG,
      API_LOCAL_MOVEMENT_LOG,
      process.env.MOVEMENT_LOG_JSON_PATH,
    );
    const data = await readFirstAccessible(candidates);

    if (data !== null) {
      return reply.status(200).send(data);
    }

    // Movement log is optional — return empty array instead of 500
    return reply.status(200).send([]);
  });

  // ── admin config diagnostic (no auth, no secrets) ────────────────────────
  // Returns whether key admin env vars are configured, without exposing values.
  // Temporary endpoint for deploy verification — remove after admin access is confirmed.
  app.get("/admin/config-check", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");

    const adminEmailsRaw = process.env.ADMIN_EMAILS ?? "";
    const adminEmails = new Set(
      adminEmailsRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    );

    const internalKeyConfigured = Boolean(process.env.INTERNAL_API_KEY);
    const internalKeyLength = (process.env.INTERNAL_API_KEY ?? "").length;

    return reply.status(200).send({
      adminEmails: {
        configured: adminEmails.size > 0,
        count: adminEmails.size,
        includesMantas: adminEmails.has("mantas.gipiskis@gmail.com"),
        includesMantasAutoshop: adminEmails.has("mantas@autoshopsmsai.com"),
      },
      internalApiKey: {
        configured: internalKeyConfigured,
        length: internalKeyLength,
      },
      bootstrapKey: {
        configured: Boolean(process.env.ADMIN_BOOTSTRAP_KEY),
      },
      jwtSecret: {
        configured: Boolean(process.env.JWT_SECRET),
      },
      nodeEnv: process.env.NODE_ENV ?? "unknown",
    });
  });

  // ── diagnostic (no auth) ─────────────────────────────────────────────────
  // Returns file metadata (resolved path, sha256, key fields) but NOT full data.
  // Used for deploy verification without requiring admin credentials.
  app.get("/admin/project-status-check", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");

    const check = async (label: string, repo: string, local: string, envKey?: string) => {
      const candidates = getCandidatePaths(repo, local, envKey);
      const result = await readFirstAccessibleWithMeta(candidates);
      if (!result) {
        return { label, found: false, candidatesChecked: candidates.length };
      }
      const sha256 = createHash("sha256").update(result.raw).digest("hex");
      const meta = (result.data as Record<string, unknown>)?.meta as
        | Record<string, unknown>
        | undefined;
      return {
        label,
        found: true,
        resolvedPath: result.path,
        sha256,
        bytes: result.raw.length,
        metaVersion: meta?.version ?? null,
        lastUpdated: meta?.last_updated ?? null,
      };
    };

    const [v1, v2, ml] = await Promise.all([
      check("project_status.json", REPO_STATUS_FILE, API_LOCAL_FILE, process.env.PROJECT_STATUS_JSON_PATH),
      check("project_status_v2.json", REPO_STATUS_V2_FILE, API_LOCAL_V2_FILE, process.env.PROJECT_STATUS_V2_JSON_PATH),
      check("movement_log.json", REPO_MOVEMENT_LOG, API_LOCAL_MOVEMENT_LOG, process.env.MOVEMENT_LOG_JSON_PATH),
    ]);

    return reply.status(200).send({ cwd: process.cwd(), files: [v1, v2, ml] });
  });
}
