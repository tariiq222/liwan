import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('admin schema (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin schema', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool); await migrate(pool) })
  afterAll(async () => { await pool.end() })
  it('creates every identity table once', async () => {
    const rows = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'vendor_%' ORDER BY 1")
    expect(rows.rows.map((r) => r.table_name)).toEqual(['vendor_account_roles','vendor_accounts','vendor_auth_attempts','vendor_auth_challenges','vendor_invitations','vendor_passkeys','vendor_recovery_codes','vendor_sessions','vendor_totp'])
  })
  it('stores emails case-insensitively unique', async () => {
    await pool.query("TRUNCATE vendor_accounts CASCADE")
    await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('a@webvue.sa','A')")
    await expect(pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('A@WEBVUE.SA','B')")).rejects.toThrow()
  })
  it('rejects unknown role keys', async () => {
    const a = await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('r@webvue.sa','R') RETURNING id")
    await expect(pool.query("INSERT INTO vendor_account_roles(account_id,role) VALUES($1,'god')", [a.rows[0].id])).rejects.toThrow()
  })
})
