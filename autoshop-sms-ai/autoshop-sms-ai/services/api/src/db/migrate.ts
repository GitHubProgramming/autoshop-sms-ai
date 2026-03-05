import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import 'dotenv/config';

export async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, '../../../../db/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT id FROM _migrations WHERE filename = $1', [file]
    );
    if (rows.length > 0) {
      console.log(`Skipping ${file} (already ran)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running ${file}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations(filename) VALUES($1)', [file]);
    console.log(`  ✓ ${file}`);
  }

  await pool.end();
  console.log('Migrations complete.');
}

if (require.main === module) {
  runMigrations().catch(err => { console.error(err); process.exit(1); });
}
