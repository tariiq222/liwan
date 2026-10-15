import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { disableAccount, setRoles, syncMembership } from '../accounts.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const issuer = 'vendor-scratch'
if (!url) describe.skip('accounts (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('accounts', () => {
  const pool = new Pool({ connectionString: url })
  let a = 0, b = 0
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts, vendor_memberships, audit_events CASCADE')
    a = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('a@nasq.sa','A','active') RETURNING id")).rows[0].id
    b = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('b@nasq.sa','B','active') RETURNING id")).rows[0].id
    await pool.query("INSERT INTO vendor_account_roles VALUES($1,'owner'),($2,'owner')", [a, b])
    await transaction(pool, async (c) => { await syncMembership(c, issuer, a); await syncMembership(c, issuer, b) })
  })
  afterAll(async () => { await pool.end() })

  it('writes the derived membership', async () => {
    await transaction(pool, (c) => setRoles(c, issuer, { id: a }, b, ['finance'], 'move to finance'))
    const row = await pool.query('SELECT capabilities, revoked_at FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2', [issuer, b])
    expect(row.rows[0]).toEqual({ capabilities: ['vendor.billing.manage','vendor.read'], revoked_at: null })
  })
  it('never leaves zero owners, even when two owners demote each other at once', async () => {
    const results = await Promise.allSettled([
      transaction(pool, (c) => setRoles(c, issuer, { id: a }, b, ['support'], 'swap')),
      transaction(pool, (c) => setRoles(c, issuer, { id: b }, a, ['support'], 'swap')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const owners = await pool.query("SELECT count(*)::int AS n FROM vendor_account_roles r JOIN vendor_accounts x ON x.id=r.account_id WHERE r.role='owner' AND x.status='active'")
    expect(owners.rows[0].n).toBe(1)
  })
  it('refuses to disable the last owner and revokes sessions of a disabled account', async () => {
    await transaction(pool, (c) => disableAccount(c, issuer, { id: a }, b, 'left the company'))
    await expect(transaction(pool, (c) => disableAccount(c, issuer, 'operator', a, 'mistake'))).rejects.toMatchObject({ code: 'last_owner' })
    const m = await pool.query('SELECT revoked_at FROM vendor_memberships WHERE actor_uid=$1', [b])
    expect(m.rows[0].revoked_at).not.toBeNull()
  })
  it('lets an owner change own roles only while another owner exists', async () => {
    await transaction(pool, (c) => setRoles(c, issuer, { id: a }, a, ['owner','finance'], 'add finance'))
    await transaction(pool, (c) => disableAccount(c, issuer, { id: a }, b, 'left'))
    await expect(transaction(pool, (c) => setRoles(c, issuer, { id: a }, a, ['finance'], 'drop owner'))).rejects.toMatchObject({ code: 'last_owner' })
  })
})
