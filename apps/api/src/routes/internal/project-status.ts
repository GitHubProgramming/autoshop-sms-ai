import { FastifyInstance } from "fastify";
import { readFile, access } from "fs/promises";
import { join, resolve } from "path";
import { adminGuard } from "../../middleware/admin-guard";

const STATUS_FILE = join("project-brain", "project_status.json");

/**
 * Build an ordered list of candidate paths for project_status.json.
 * The first accessible path wins.
 */
function getCandidatePaths(): string[] {
  const candidates: string[] = [];

  // 1. Explicit env var override (highest priority)
  if (process.env.PROJECT_STATUS_JSON_PATH) {
    candidates.push(resolve(process.env.PROJECT_STATUS_JSON_PATH));
  }

  // 2. Relative to cwd (works when process runs from repo root)
  candidates.push(resolve(process.cwd(), STATUS_FILE));

  // 3. Relative to __dirname — walk up from compiled dist/routes/internal/
  candidates.push(resolve(__dirname, "..", "..", "..", "..", "..", STATUS_FILE));

  // 4. Relative to __dirname — walk up from src/routes/internal/ (ts-node / tsx)
  candidates.push(resolve(__dirname, "..", "..", "..", STATUS_FILE));

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
