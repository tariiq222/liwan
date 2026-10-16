import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('schema 022 (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('schema 022', () => {
  const pool = new Pool({ connectionString: url })
  afterAll(async () => { await pool.end() })

  it('keeps no second copy of vendor authority', async () => {
    await migrate(pool)
    const copy = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='vendor_memberships'")
    expect(copy.rowCount).toBe(0)
  })
})
