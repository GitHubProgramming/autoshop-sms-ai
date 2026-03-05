import { Pool, PoolClient } from 'pg';

let pool: Pool;

export function initDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('PG pool error:', err);
    });
  }
  return pool;
}

export function getPool(): Pool {
  if (!pool) throw new Error('DB not initialized');
  return pool;
}

// Execute a function inside a transaction with tenant isolation
export async function withTenantTx<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Set RLS context
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Query helper for single-tenant reads (sets RLS context)
export async function tenantQuery<T>(
  tenantId: string,
  text: string,
  params: unknown[]
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
