/**
 * reset-tenant-data.ts
 *
 * One-time script to delete all historical conversation, message, appointment,
 * customer, and pipeline data for a specific tenant — leaving the account,
 * billing, integrations, and configuration intact.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx src/scripts/reset-tenant-data.ts
 *
 * Requires DATABASE_URL in environment (loaded from ../../.env).
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });
import { Pool } from "pg";

// ── Target tenant ──
const TARGET_EMAIL = "mantas.gipiskis@gmail.com";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set. Load .env or export it.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10_000,
  });

  const client = await pool.connect();

  try {
    // ── 1. Identify tenant ──
    const tenantRes = await client.query(
      `SELECT id, shop_name, billing_status, workspace_mode, conv_used_this_cycle
       FROM tenants WHERE owner_email = $1`,
      [TARGET_EMAIL]
    );
    if (tenantRes.rows.length === 0) {
      console.error(`No tenant found for email: ${TARGET_EMAIL}`);
      process.exit(1);
    }
    const tenant = tenantRes.rows[0];
    const tid = tenant.id;
    console.log(`\nTENANT IDENTIFIED`);
    console.log(`  id:              ${tid}`);
    console.log(`  shop_name:       ${tenant.shop_name}`);
    console.log(`  billing_status:  ${tenant.billing_status}`);
    console.log(`  workspace_mode:  ${tenant.workspace_mode}`);
    console.log(`  conv_used:       ${tenant.conv_used_this_cycle}`);

    // ── 2. Pre-delete counts ──
    console.log(`\nPRE-DELETE ROW COUNTS:`);
    const tables = [
      "messages",
      "conversations",
      "appointments",
      "customers",
      "vehicles",
      "bookings",
      "missed_calls",
      "pipeline_alerts",
      "pipeline_traces",
      "conversation_cooldowns",
      "webhook_events",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`,
        [tid]
      );
      counts[t] = r.rows[0].n;
      console.log(`  ${t.padEnd(28)} ${counts[t]}`);
    }

    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalRows === 0) {
      console.log(`\nNo data to delete — tenant is already clean.`);
      await client.release();
      await pool.end();
      process.exit(0);
    }

    // ── 3. Delete in FK-safe order inside a transaction ──
    console.log(`\nDELETING tenant data in FK-safe order...`);
    await client.query("BEGIN");

    // Level 1: leaf tables (no dependents)
    const deleted: Record<string, number> = {};

    let res = await client.query(
      `DELETE FROM pipeline_alerts WHERE tenant_id = $1`,
      [tid]
    );
    deleted["pipeline_alerts"] = res.rowCount ?? 0;

    res = await client.query(
      `DELETE FROM pipeline_traces WHERE tenant_id = $1`,
      [tid]
    );
    deleted["pipeline_traces"] = res.rowCount ?? 0;

    res = await client.query(
      `DELETE FROM webhook_events WHERE tenant_id = $1`,
      [tid]
    );
    deleted["webhook_events"] = res.rowCount ?? 0;

    res = await client.query(
      `DELETE FROM conversation_cooldowns WHERE tenant_id = $1`,
      [tid]
    );
    deleted["conversation_cooldowns"] = res.rowCount ?? 0;

    res = await client.query(
      `DELETE FROM missed_calls WHERE tenant_id = $1`,
      [tid]
    );
    deleted["missed_calls"] = res.rowCount ?? 0;

    // Level 2: messages depend on conversations
    res = await client.query(
      `DELETE FROM messages WHERE tenant_id = $1`,
      [tid]
    );
    deleted["messages"] = res.rowCount ?? 0;

    // Level 3: bookings depend on customers, vehicles, conversations
    res = await client.query(
      `DELETE FROM bookings WHERE tenant_id = $1`,
      [tid]
    );
    deleted["bookings"] = res.rowCount ?? 0;

    // Level 4: appointments (conversations.appointment_id FK)
    // First null out the FK on conversations, then delete appointments
    await client.query(
      `UPDATE conversations SET appointment_id = NULL WHERE tenant_id = $1`,
      [tid]
    );
    res = await client.query(
      `DELETE FROM appointments WHERE tenant_id = $1`,
      [tid]
    );
    deleted["appointments"] = res.rowCount ?? 0;

    // Level 5: conversations
    res = await client.query(
      `DELETE FROM conversations WHERE tenant_id = $1`,
      [tid]
    );
    deleted["conversations"] = res.rowCount ?? 0;

    // Level 6: vehicles depend on customers
    res = await client.query(
      `DELETE FROM vehicles WHERE tenant_id = $1`,
      [tid]
    );
    deleted["vehicles"] = res.rowCount ?? 0;

    // Level 7: customers
    res = await client.query(
      `DELETE FROM customers WHERE tenant_id = $1`,
      [tid]
    );
    deleted["customers"] = res.rowCount ?? 0;

    // ── 4. Reset usage counters on tenant ──
    await client.query(
      `UPDATE tenants SET
         conv_used_this_cycle = 0,
         warned_80pct = FALSE,
         warned_100pct = FALSE
       WHERE id = $1`,
      [tid]
    );

    await client.query("COMMIT");

    // ── 5. Report ──
    console.log(`\nDELETED ROWS:`);
    for (const [table, n] of Object.entries(deleted)) {
      if (n > 0) console.log(`  ${table.padEnd(28)} ${n}`);
    }
    const totalDeleted = Object.values(deleted).reduce((a, b) => a + b, 0);
    console.log(`  ${"TOTAL".padEnd(28)} ${totalDeleted}`);

    console.log(`\nUSAGE COUNTERS RESET:`);
    console.log(`  conv_used_this_cycle  → 0`);
    console.log(`  warned_80pct          → FALSE`);
    console.log(`  warned_100pct         → FALSE`);

    // ── 6. Post-delete verification ──
    console.log(`\nPOST-DELETE VERIFICATION:`);
    for (const t of tables) {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`,
        [tid]
      );
      const remaining = r.rows[0].n;
      const status = remaining === 0 ? "CLEAN" : `WARNING: ${remaining} rows remain`;
      console.log(`  ${t.padEnd(28)} ${status}`);
    }

    // ── 7. Verify preserved data ──
    console.log(`\nPRESERVED DATA:`);
    const tenantCheck = await client.query(
      `SELECT id, shop_name, billing_status, workspace_mode FROM tenants WHERE id = $1`,
      [tid]
    );
    console.log(`  tenant record:         ${tenantCheck.rows.length > 0 ? "OK" : "MISSING!"}`);

    const userCheck = await client.query(
      `SELECT count(*)::int AS n FROM users WHERE tenant_id = $1`,
      [tid]
    );
    console.log(`  user records:          ${userCheck.rows[0].n}`);

    const phoneCheck = await client.query(
      `SELECT phone_number, status FROM tenant_phone_numbers WHERE tenant_id = $1`,
      [tid]
    );
    console.log(`  phone numbers:         ${phoneCheck.rows.length > 0 ? phoneCheck.rows.map((r: any) => `${r.phone_number} (${r.status})`).join(", ") : "none"}`);

    const calCheck = await client.query(
      `SELECT calendar_id FROM tenant_calendar_tokens WHERE tenant_id = $1`,
      [tid]
    );
    console.log(`  calendar integration:  ${calCheck.rows.length > 0 ? "connected" : "none"}`);

    const promptCheck = await client.query(
      `SELECT count(*)::int AS n FROM system_prompts WHERE tenant_id = $1`,
      [tid]
    );
    console.log(`  system prompts:        ${promptCheck.rows[0].n}`);

    const serviceCheck = await client.query(
      `SELECT count(*)::int AS n FROM tenant_services WHERE tenant_id = $1`,
      [tid]
    );
    console.log(`  tenant services:       ${serviceCheck.rows[0].n}`);

    console.log(`\nREADY FOR FRESH BOOKING TEST: YES`);
    console.log(`Done.\n`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK — error during cleanup:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
