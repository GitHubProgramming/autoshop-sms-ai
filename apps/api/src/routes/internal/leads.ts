import { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../../db/client";
import { requireInternal } from "../../middleware/require-internal";

// ── Schemas ──────────────────────────────────────────────────────────────────

const BulkInsertSchema = z.object({
  leads: z.array(z.object({
    business_name: z.string().default(""),
    website: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().default(""),
    city: z.string().default(""),
    state: z.string().default("TX"),
    place_id: z.string().min(1),
  })).min(1).max(500),
});

const EnrichUpdateSchema = z.object({
  final_email: z.string().nullable().optional(),
  final_email_status: z.string(),
  final_email_source_url: z.string().nullable().optional(),
  final_lead_status: z.string(),
  final_needs_manual_review: z.boolean(),
});

const ExportDecisionSchema = z.object({
  decisions: z.array(z.object({
    id: z.string().uuid(),
    export_decision: z.string(),
    smartlead_decision: z.string(),
    review_decision: z.boolean(),
  })).min(1).max(200),
});

// ── Route ────────────────────────────────────────────────────────────────────

export async function leadsRoute(app: FastifyInstance) {

  /**
   * POST /internal/leads/bulk-insert
   *
   * Bulk-inserts scraped leads into lead_master.
   * Skips duplicates by place_id (ON CONFLICT DO NOTHING).
   * Called by: WF-SCRAPE-TEXAS-LEADS
   */
  app.post("/leads/bulk-insert", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = BulkInsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { leads } = parsed.data;

    // Build parameterized multi-row INSERT
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const lead of leads) {
      placeholders.push(
        `(gen_random_uuid(), $${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, 'missing', 'new', 'none', 'pending', 'none', false, NOW(), NOW())`
      );
      values.push(
        lead.business_name,
        lead.website ?? null,
        lead.domain ?? null,
        lead.phone ?? null,
        lead.address,
        lead.city,
        lead.state,
        lead.place_id,
      );
      idx += 8;
    }

    const sql = `
      INSERT INTO lead_master
        (id, business_name, website, domain, phone, address, city, state, place_id,
         email_status, lead_status, outreach_status, export_status, smartlead_status,
         needs_manual_review, created_at, updated_at)
      VALUES ${placeholders.join(",\n")}
      ON CONFLICT (place_id) DO NOTHING
      RETURNING id, business_name, domain
    `;

    const rows = await query<{ id: string; business_name: string; domain: string | null }>(sql, values);

    request.log.info({ submitted: leads.length, inserted: rows.length }, "Leads bulk-insert complete");

    return reply.status(201).send({
      submitted: leads.length,
      inserted: rows.length,
      skipped: leads.length - rows.length,
      rows,
    });
  });

  /**
   * GET /internal/leads/pending-enrichment
   *
   * Returns leads that need email enrichment (have domain but no email).
   * Called by: WF-ENRICH-EMAILS-BASIC
   */
  app.get("/leads/pending-enrichment", { preHandler: [requireInternal] }, async (request, reply) => {
    const rows = await query<{
      id: string; business_name: string; website: string; domain: string;
      email: string | null; email_status: string; lead_status: string; outreach_status: string;
    }>(`
      SELECT id, business_name, website, domain, email, email_status, lead_status, outreach_status
      FROM lead_master
      WHERE lead_status IN ('new', 'needs_enrichment')
        AND email_status IN ('missing', 'not_found_scrape')
        AND website IS NOT NULL
        AND domain IS NOT NULL
        AND outreach_status = 'none'
      ORDER BY created_at ASC
      LIMIT 20
    `);

    return reply.send({ count: rows.length, leads: rows });
  });

  /**
   * PUT /internal/leads/:id/enrichment
   *
   * Updates a single lead with email enrichment results.
   * Called by: WF-ENRICH-EMAILS-BASIC
   */
  app.put("/leads/:id/enrichment", { preHandler: [requireInternal] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return reply.status(400).send({ error: "Invalid lead ID" });
    }

    const parsed = EnrichUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const d = parsed.data;
    const rows = await query<{
      id: string; email: string | null; email_status: string;
      lead_status: string; needs_manual_review: boolean;
    }>(`
      UPDATE lead_master
      SET
        email = CASE
          WHEN $2 IN ('verified', 'risky') AND COALESCE($3, '') != ''
               AND (email IS NULL OR email_status != 'verified')
          THEN $3 ELSE email
        END,
        email_source_url = CASE
          WHEN $2 IN ('verified', 'risky') AND COALESCE($3, '') != ''
               AND (email IS NULL OR email_status != 'verified')
          THEN $4 ELSE email_source_url
        END,
        email_found_at = CASE
          WHEN $2 IN ('verified', 'risky') AND COALESCE($3, '') != ''
               AND (email IS NULL OR email_status != 'verified')
          THEN NOW() ELSE email_found_at
        END,
        email_status = $2,
        lead_status = $5,
        needs_manual_review = $6,
        updated_at = NOW()
      WHERE id = $1::uuid
        AND NOT (email_status = 'verified' AND $2 != 'verified')
      RETURNING id, email, email_status, lead_status, needs_manual_review
    `, [id, d.final_email_status, d.final_email ?? null, d.final_email_source_url ?? null, d.final_lead_status, d.final_needs_manual_review]);

    if (rows.length === 0) {
      return reply.status(404).send({ error: "Lead not found or update skipped" });
    }

    return reply.send(rows[0]);
  });

  /**
   * GET /internal/leads/export-candidates
   *
   * Returns leads ready for Smartlead export (approved + verified/risky email).
   * Called by: WF-PREPARE-SMARTLEAD-EXPORT
   */
  app.get("/leads/export-candidates", { preHandler: [requireInternal] }, async (request, reply) => {
    const rows = await query<{
      id: string; business_name: string; website: string | null; domain: string;
      email: string; email_status: string; lead_status: string; outreach_status: string;
      export_status: string; smartlead_status: string | null;
      needs_manual_review: boolean; created_at: string; updated_at: string;
    }>(`
      SELECT id, business_name, website, domain, email,
             email_status, lead_status, outreach_status,
             export_status, smartlead_status,
             needs_manual_review, created_at, updated_at
      FROM lead_master
      WHERE outreach_status = 'none'
        AND lead_status = 'approved'
        AND email_status IN ('verified', 'risky')
        AND email IS NOT NULL
        AND domain IS NOT NULL
        AND COALESCE(smartlead_status, 'none') NOT IN ('exported', 'pending_export')
      ORDER BY created_at ASC
      LIMIT 50
    `);

    return reply.send({ count: rows.length, leads: rows });
  });

  /**
   * POST /internal/leads/export-decisions
   *
   * Batch-updates leads with export/dedup decisions.
   * Called by: WF-PREPARE-SMARTLEAD-EXPORT
   */
  app.post("/leads/export-decisions", { preHandler: [requireInternal] }, async (request, reply) => {
    const parsed = ExportDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const results: Array<{
      id: string; business_name: string; email: string; domain: string;
      export_status: string; smartlead_status: string; needs_manual_review: boolean;
    }> = [];

    for (const d of parsed.data.decisions) {
      const rows = await query<{
        id: string; business_name: string; email: string; domain: string; website: string | null;
        email_status: string; lead_status: string; export_status: string;
        smartlead_status: string; needs_manual_review: boolean;
      }>(`
        UPDATE lead_master
        SET
          export_status = $2,
          smartlead_status = CASE
            WHEN COALESCE(smartlead_status, 'none') = 'exported' THEN smartlead_status
            ELSE $3
          END,
          needs_manual_review = CASE WHEN $4 THEN true ELSE needs_manual_review END,
          updated_at = NOW()
        WHERE id = $1::uuid
          AND COALESCE(smartlead_status, 'none') != 'exported'
          AND COALESCE(outreach_status, 'none') NOT IN ('queued', 'sent', 'replied', 'bounced')
        RETURNING id, business_name, email, domain, website,
                  email_status, lead_status, export_status,
                  smartlead_status, needs_manual_review
      `, [d.id, d.export_decision, d.smartlead_decision, d.review_decision]);

      if (rows.length > 0) results.push(rows[0]);
    }

    const ready = results.filter(r => r.export_status === "ready").length;
    const blocked = results.filter(r => r.export_status === "blocked").length;
    const duplicate = results.filter(r => r.export_status === "duplicate").length;

    request.log.info(
      { total: parsed.data.decisions.length, updated: results.length, ready, blocked, duplicate },
      "Export decisions applied"
    );

    return reply.send({
      total_decisions: parsed.data.decisions.length,
      db_updated: results.length,
      db_skipped: parsed.data.decisions.length - results.length,
      ready_for_export: ready,
      blocked,
      duplicates: duplicate,
      rows: results,
    });
  });
}
