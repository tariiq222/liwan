import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('schema 022 (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('schema 022', () => {
  const pool = new Pool({ connectionString: url })
  afterAll(async () => { await pool.end() })

  it('revokes legacy uid-keyed memberships when the migration runs', async () => {
    await migrate(pool)
    const sql = await readFile(new URL('../../schema_022.sql', import.meta.url), 'utf8')
    const statement = /UPDATE vendor_memberships[^;]*;/.exec(sql)?.[0]
    expect(statement).toBeDefined()
    await pool.query('TRUNCATE vendor_memberships')
    await pool.query("INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ('legacy-issuer',7,'{}')")
    await pool.query(statement as string)
    expect((await pool.query("SELECT revoked_at FROM vendor_memberships WHERE actor_uid=7")).rows[0].revoked_at).not.toBeNull()
  })
})
