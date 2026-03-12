import { FastifyInstance } from "fastify";
import { readFile } from "fs/promises";
import { join } from "path";
import { adminGuard } from "../../middleware/admin-guard";

/**
 * GET /internal/admin/project-status
 *
 * Reads project-brain/project_status.json from disk and returns it as-is.
 * Read-only endpoint for the Project Ops dashboard.
 */
export async function projectStatusRoute(app: FastifyInstance) {
  app.get("/admin/project-status", { preHandler: [adminGuard] }, async (_req, reply) => {
    try {
      // Resolve path relative to project root (3 levels up from src/routes/internal/)
      const filePath = join(__dirname, "../../../../../project-brain/project_status.json");
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      return reply.status(200).send(data);
    } catch (err: any) {
      app.log.error({ err }, "Failed to read project_status.json");
      return reply.status(500).send({
        error: "Failed to read project status file",
        message: err.message,
      });
    }
  });
}
