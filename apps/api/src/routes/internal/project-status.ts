import { FastifyInstance } from "fastify";
import { readFile, access } from "fs/promises";
import { join, resolve } from "path";
import { adminGuard } from "../../middleware/admin-guard";

const REPO_STATUS_FILE = join("project-brain", "project_status.json");
const API_LOCAL_FILE = join("project-status", "project_status.json");

/**
 * Build an ordered list of candidate paths for project_status.json.
 * The first accessible path wins.
 *
 * Priority:
 *   1. Env override (PROJECT_STATUS_JSON_PATH)
 *   2. API-local deploy-safe copy (apps/api/project-status/ — guaranteed in container)
 *   3. Legacy repo-root fallbacks (only useful in local dev)
 */
function getCandidatePaths(): string[] {
  const candidates: string[] = [];

  // 1. Explicit env var override (highest priority)
  if (process.env.PROJECT_STATUS_JSON_PATH) {
    candidates.push(resolve(process.env.PROJECT_STATUS_JSON_PATH));
  }

  // 2. API-local runtime copy — deploy-safe, lives inside apps/api/
  //    In container: /app/project-status/project_status.json
  candidates.push(resolve(process.cwd(), API_LOCAL_FILE));
  //    Relative to compiled dist/routes/internal/ -> ../../.. -> /app/
  candidates.push(resolve(__dirname, "..", "..", "..", API_LOCAL_FILE));

  // 3. Legacy: repo-root project-brain/ (works in local dev from repo root)
  candidates.push(resolve(process.cwd(), REPO_STATUS_FILE));
  candidates.push(resolve(__dirname, "..", "..", "..", "..", "..", REPO_STATUS_FILE));
  candidates.push(resolve(__dirname, "..", "..", "..", REPO_STATUS_FILE));

  return candidates;
}

/**
 * GET /internal/admin/project-status
 *
 * Reads project-brain/project_status.json from disk and returns it as-is.
 * Read-only endpoint for the Project Ops dashboard.
 */
export async function projectStatusRoute(app: FastifyInstance) {
  app.get("/admin/project-status", { preHandler: [adminGuard] }, async (_req, reply) => {
    const candidates = getCandidatePaths();

    for (const filePath of candidates) {
      try {
        await access(filePath);
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        return reply.status(200).send(data);
      } catch {
        // This candidate didn't work — try next
      }
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
}
