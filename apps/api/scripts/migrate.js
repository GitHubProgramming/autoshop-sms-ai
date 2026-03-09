'use strict';

/**
 * migrate.js — runs SQL migration files in order against DATABASE_URL.
 * Tracks applied migrations in _migrations table (created if absent).
 * Exits with code 1 on any failure so the container restart loop catches it.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  console.log('[migrate] connecting to database…');
  await client.connect();

  try {
    // Tracking table — survives re-deploys
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query('SELECT name FROM _migrations ORDER BY name');
    const applied = new Set(rows.map(r => r.name));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('[migrate] no migration files found — nothing to do');
      return;
    }

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip (already applied): ${file}`);
        continue;
      }

      console.log(`[migrate] applying: ${file}`);
      let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      // Strip the file's own BEGIN/COMMIT so we can wrap atomically with the
      // _migrations INSERT in a single transaction.
      sql = sql.replace(/^\s*BEGIN\s*;/im, '').replace(/COMMIT\s*;\s*$/im, '');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log('[migrate] all migrations applied successfully');
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('[migrate] FATAL —', err.message);
  process.exit(1);
});
