import { FastifyInstance } from "fastify";
import { adminGuard } from "../../middleware/admin-guard";

/**
 * Project Ops endpoints — DEPRECATED.
 *
 * The project status JSON files were removed as part of the Project Brain
 * cleanup (project-brain is now a context system, not a progress tracker).
 * These endpoints return deprecation notices instead of 500 errors.
 */
export async function projectStatusRoute(app: FastifyInstance) {
  const deprecated = {
    deprecated: true,
    message:
      "Project Ops has been deprecated. Use GitHub Projects for task tracking.",
  };

  app.get(
    "/admin/project-status",
    { preHandler: [adminGuard] },
    async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.status(200).send(deprecated);
    },
  );

  app.get(
    "/admin/project-status-v2",
    { preHandler: [adminGuard] },
    async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.status(200).send(deprecated);
    },
  );

  app.get(
    "/admin/movement-log",
    { preHandler: [adminGuard] },
    async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.status(200).send([]);
    },
  );

  app.get("/admin/project-status-check", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.status(200).send(deprecated);
  });
}
