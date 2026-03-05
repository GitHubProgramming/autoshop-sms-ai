import 'dotenv/config';
import { Pool } from 'pg';

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // Insert a dev tenant
  const { rows } = await pool.query(`
    INSERT INTO tenants (clerk_org_id, shop_name, phone, timezone, billing_state)
    VALUES ('org_dev_test', 'Dev Auto Shop', '+12145550001', 'America/Chicago', 'trial')
    ON CONFLICT (clerk_org_id) DO UPDATE SET shop_name = EXCLUDED.shop_name
    RETURNING id
  `);
  
  const tenantId = rows[0].id;
  
  await pool.query(`
    INSERT INTO subscriptions (tenant_id, stripe_customer_id)
    VALUES ($1, 'cus_dev_test')
    ON CONFLICT DO NOTHING
  `, [tenantId]);

  console.log(`Seeded dev tenant: ${tenantId}`);
  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
