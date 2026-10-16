import { readFile } from 'node:fs/promises'
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
  it('tags legacy uid audit actors and leaves the current format alone', async () => {
    await migrate(pool)
    const sql = await readFile(new URL('../../schema_022.sql', import.meta.url), 'utf8')
    const statements = sql.match(/UPDATE audit_events[^;]*;/g) ?? []
    expect(statements).toHaveLength(2)
    const actors = ['7', 'vendor-scratch:7', 'account:7', 'operator', 'anonymous', 'legacy-migration:1', 'x:commercial-fulfillment:1']
    for (const [index, actor] of actors.entries()) await pool.query("INSERT INTO audit_events(id,actor,action,subject,reason) VALUES(gen_random_uuid(),$1,'legacy.test',$2,'fixture')", [actor, `fixture:${index}`])
    for (const statement of statements) await pool.query(statement)
    const rows = await pool.query("SELECT actor FROM audit_events WHERE action='legacy.test' ORDER BY subject")
    await pool.query("DELETE FROM audit_events WHERE action='legacy.test'")
    expect(rows.rows.map((r) => r.actor)).toEqual(['legacy-uid:7', 'legacy-uid:vendor-scratch:7', 'account:7', 'operator', 'anonymous', 'legacy-migration:1', 'x:commercial-fulfillment:1'])
  })
  it('refuses an active account without a password and a TOTP row without confirmation', async () => {
    await migrate(pool)
    await expect(pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('nopass@nasq.sa','N','active')")).rejects.toMatchObject({ code: '23514' })
    const id = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('enrolling@nasq.sa','E') RETURNING id")).rows[0].id)
    await expect(pool.query("INSERT INTO vendor_totp(account_id,secret_box) VALUES($1,'\\x00')", [id])).rejects.toMatchObject({ code: '23502' })
    await pool.query('DELETE FROM vendor_accounts WHERE id=$1', [id])
  })
})
