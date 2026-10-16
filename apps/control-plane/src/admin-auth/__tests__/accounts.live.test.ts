import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { disableAccount, setRoles } from '../accounts.js'
import { accountCapabilities } from '../grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('accounts (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('accounts', () => {
  const pool = new Pool({ connectionString: url })
  let a = 0, b = 0
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts, audit_events CASCADE')
    a = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES('a@webvue.sa','A','active','x') RETURNING id")).rows[0].id
    b = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES('b@webvue.sa','B','active','x') RETURNING id")).rows[0].id
    await pool.query("INSERT INTO vendor_account_roles VALUES($1,'owner'),($2,'owner')", [a, b])
  })
  afterAll(async () => { await pool.end() })

  it('computes authority from the roles at once, with no copy to sync', async () => {
    expect(await accountCapabilities(pool, b)).toContain('vendor.accounts.manage')
    await transaction(pool, (c) => setRoles(c, { id: a }, b, ['finance'], 'move to finance'))
    expect(await accountCapabilities(pool, b)).toEqual(['vendor.billing.manage', 'vendor.read'])
  })
  it('refuses a mutation from an actor that is no longer an owner inside the transaction', async () => {
    await transaction(pool, (c) => setRoles(c, { id: a }, b, ['support'], 'demote'))
    await expect(transaction(pool, (c) => disableAccount(c, { id: b }, a, 'takeover'))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(transaction(pool, (c) => setRoles(c, { id: b }, a, ['support'], 'takeover'))).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('never leaves zero owners, even when two owners demote each other at once', async () => {
    const results = await Promise.allSettled([
      transaction(pool, (c) => setRoles(c, { id: a }, b, ['support'], 'swap')),
      transaction(pool, (c) => setRoles(c, { id: b }, a, ['support'], 'swap')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const owners = await pool.query("SELECT count(*)::int AS n FROM vendor_account_roles r JOIN vendor_accounts x ON x.id=r.account_id WHERE r.role='owner' AND x.status='active'")
    expect(owners.rows[0].n).toBe(1)
  })
  it('refuses to disable the last owner and revokes sessions of a disabled account', async () => {
    await transaction(pool, (c) => disableAccount(c, { id: a }, b, 'left the company'))
    await expect(transaction(pool, (c) => disableAccount(c, 'operator', a, 'mistake'))).rejects.toMatchObject({ code: 'last_owner' })
    expect(await accountCapabilities(pool, b)).toBeNull()
  })
  it('lets an owner change own roles only while another owner exists', async () => {
    await transaction(pool, (c) => setRoles(c, { id: a }, a, ['owner','finance'], 'add finance'))
    await transaction(pool, (c) => disableAccount(c, { id: a }, b, 'left'))
    await expect(transaction(pool, (c) => setRoles(c, { id: a }, a, ['finance'], 'drop owner'))).rejects.toMatchObject({ code: 'last_owner' })
  })
  it('lets the only owner edit own roles while keeping the owner role', async () => {
    await transaction(pool, (c) => disableAccount(c, { id: a }, b, 'left'))
    await transaction(pool, (c) => setRoles(c, { id: a }, a, ['owner', 'finance'], 'add finance'))
    const roles = await pool.query('SELECT role FROM vendor_account_roles WHERE account_id=$1 ORDER BY role', [a])
    expect(roles.rows.map((r) => r.role)).toEqual(['finance', 'owner'])
  })
})
