#!/usr/bin/env node
/**
 * migrate.js — deterministic migration runner
 *
 * Usage:
 *   cd apps/api && node scripts/migrate.js
 *   or: npm run db:migrate
 *
 * Reads SQL files from ../../db/migrations/ in filename order.
 * Tracks applied migrations in public.schema_migrations table.
 * Safe to rerun — already-applied migrations are skipped.
 * Fails loudly on any migration error.
 *
 * Bootstrap detection:
 *   On first run against an already-initialized database (schema_migrations
 *   table is empty but tenants table exists), all on-disk migration files
 *   are recorded as already-applied WITHOUT re-executing their SQL. This
 *   handles the case where migrations were previously run via Docker init
 *   scripts (which only execute on first container creation).
 *
 * Requires DATABASE_URL env var (or individual PG* vars).
 * Loads .env from project root if present.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Load .env from project root (three levels up from apps/api/scripts/)
const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'db', 'migrations');

async function run() {
  const connString = process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || 'autoshop'}:${process.env.POSTGRES_PASSWORD || 'autoshop_secret'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'autoshop'}`;

  console.log(`[migrate] Connecting to database...`);
  const client = new Client({ connectionString: connString });
  await client.connect();
  console.log('[migrate] Connected.');

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read all .sql files, sort by filename (lexicographic = numeric order for NNN_ prefix)
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[migrate] No migration files found in', MIGRATIONS_DIR);
      return;
    }

    // Load already-applied migrations
    const { rows: applied } = await client.query(
      'SELECT filename FROM public.schema_migrations'
    );
    const appliedSet = new Set(applied.map(r => r.filename));

    // Bootstrap detection: schema_migrations is empty but the DB is already
    // initialized (tenants table exists). This means migrations were applied
    // previously via Docker init scripts. Record all on-disk files as applied
    // without re-executing their SQL.
    if (appliedSet.size === 0) {
      const { rows: tenantsCheck } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants' LIMIT 1
      `);
      if (tenantsCheck.length > 0) {
        console.log('[migrate] BOOTSTRAP: tenants table exists but schema_migrations is empty.');
        console.log('[migrate] Recording all on-disk migrations as already applied (no SQL executed).');
        for (const file of files) {
          await client.query(
            'INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file]
          );
          console.log(`[migrate] RECORDED ${file}`);
          appliedSet.add(file);
        }
        console.log('\n[migrate] Bootstrap complete. All migrations recorded. Rerun to apply any future migrations.');
        return;
      }
    }

    let newCount = 0;
    let skipCount = 0;

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrate] SKIP  ${file} (already applied)`);
        skipCount++;
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`[migrate] APPLY ${file}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`[migrate] DONE  ${file}`);
        newCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] FAILED ${file}: ${err.message}`);
        throw err; // fail loudly
      }
    }

    console.log(`\n[migrate] Complete. Applied: ${newCount}, Skipped: ${skipCount}`);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('[migrate] Fatal:', err.message);
  process.exit(1);
});
