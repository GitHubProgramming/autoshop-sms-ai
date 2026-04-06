import { Pool, PoolClient } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

db.on("error", (err) => {
  console.error("Unexpected postgres pool error:", err);
});

/**
 * Execute a query with tenant isolation enforced via RLS.
 * MUST be used for all tenant-scoped queries.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    // Set tenant context for RLS — this is the security boundary
    // Uses set_config() instead of SET LOCAL to allow parameterized input.
    // Third arg = true means "local to current transaction".
    await client.query(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      [tenantId]
    );
    const result = await fn(client);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Query without tenant context (admin/system operations only).
 * Do NOT use for tenant-scoped data.
 */
export async function query<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

/**
 * Execute a callback inside a PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK).
 * The callback receives a PoolClient that must be used for all queries within
 * the transaction. If the callback throws, the transaction is rolled back.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
