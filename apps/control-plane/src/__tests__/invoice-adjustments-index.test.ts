import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('invoice adjustments index (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('invoice adjustments index', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => { await pool.end() })

  // Settlement, refunds, invoice views and the AI top-up refund read the notes of one invoice by `invoice_id`; the only index that starts with it is partial.
  it('lets the lookup of one invoice\'s notes use an index', async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // A synthetic table of 30,000 notes over 10,000 invoices; the foreign keys are skipped for this one transaction, which is rolled back.
      await client.query('SET LOCAL session_replication_role = replica')
      await client.query(`INSERT INTO invoice_adjustments(id,invoice_id,customer_id,kind,reason,amount_minor,currency,exponent,status,created_by,origin,cause)
        SELECT gen_random_uuid(), md5((g % 10000)::text)::uuid, gen_random_uuid(), 'credit_note', 'seeded note', 100, 'SAR', 2, 'applied', 'test', 'vendor', 'vendor_refund' FROM generate_series(1, 30000) g`)
      await client.query('ANALYZE invoice_adjustments')
      const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN SELECT id FROM invoice_adjustments WHERE invoice_id = '${'c4ca4238-a0b9-2382-0dcc-509a6f75849b'}' AND kind = 'credit_note' AND status <> 'void'`)
      const text = plan.rows.map(row => row['QUERY PLAN']).join('\n')
      expect(text).toMatch(/Index (Only )?Scan|Bitmap Index Scan/)
      expect(text).not.toContain('Seq Scan')
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
