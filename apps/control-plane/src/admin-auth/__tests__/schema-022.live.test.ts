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
  it('refuses an active account without a password and a TOTP row without confirmation', async () => {
    await migrate(pool)
    await expect(pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('nopass@nasq.sa','N','active')")).rejects.toMatchObject({ code: '23514' })
    const id = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('enrolling@nasq.sa','E') RETURNING id")).rows[0].id)
    await expect(pool.query("INSERT INTO vendor_totp(account_id,secret_box) VALUES($1,'\\x00')", [id])).rejects.toMatchObject({ code: '23502' })
    await pool.query('DELETE FROM vendor_accounts WHERE id=$1', [id])
  })
})
