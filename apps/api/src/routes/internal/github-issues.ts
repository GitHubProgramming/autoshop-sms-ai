import { FastifyInstance } from "fastify";
import { adminGuard } from "../../middleware/admin-guard";

/**
 * GET /internal/admin/github-issues
 *
 * Read-only proxy to GitHub REST API — returns issues from the configured repo.
 * Requires GITHUB_TOKEN and GITHUB_REPO (owner/repo) env vars.
 */
export async function githubIssuesRoute(app: FastifyInstance) {
  app.get("/admin/github-issues", { preHandler: [adminGuard] }, async (request, reply) => {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO; // e.g. "owner/repo"

    if (!token || !repo) {
      return reply.status(503).send({
        error: "GitHub integration not configured — set GITHUB_TOKEN and GITHUB_REPO env vars",
      });
    }

    const q = request.query as { state?: string; per_page?: string };
    const state = q.state ?? "all";
    const perPage = Math.min(parseInt(q.per_page ?? "100", 10) || 100, 100);

    const url = `https://api.github.com/repos/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated&direction=desc`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!res.ok) {
        const body = await res.text();
        request.log.error({ status: res.status, body }, "GitHub API error");
        return reply.status(502).send({
          error: `GitHub API returned ${res.status}`,
          detail: body.slice(0, 500),
        });
      }

      const issues = await res.json();

      // Filter out pull requests (GitHub returns PRs in the issues endpoint)
      const filtered = (issues as any[]).filter((i: any) => !i.pull_request);

      // Map to minimal shape
      const mapped = filtered.map((i: any) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: (i.labels as any[]).map((l: any) => ({
          name: l.name,
          color: l.color,
        })),
        created_at: i.created_at,
        updated_at: i.updated_at,
        html_url: i.html_url,
      }));

      return reply.send({ count: mapped.length, issues: mapped });
    } catch (err: any) {
      request.log.error({ err }, "Failed to fetch GitHub issues");
      return reply.status(502).send({ error: "Failed to reach GitHub API" });
    }
  });
}
