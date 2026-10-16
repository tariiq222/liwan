import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { replaceRoles, vendorAccount } from '../../__tests__/helpers/vendor-session.js'
import { requireJobAuthority } from '../../shared/job-store.js'
import { requireOnboardingAuthority } from '../../shared/onboarding.js'
import { actorHolds, actorHoldsSql, actorLabel, vendorActorIssuer } from '../grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const issuer = vendorActorIssuer('vendor-scratch')
if (!url) describe.skip('vendor grants (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('vendor grants', () => {
  const pool = new Pool({ connectionString: url })
  let id = 0
  const actor = () => ({ issuer, actorUid: id })
  const sqlHolds = async (capabilities: Parameters<typeof actorHoldsSql>[2]) =>
    Boolean((await pool.query(`SELECT 1 FROM (SELECT $1::text AS issuer, $2::bigint AS actor_uid) queued WHERE ${actorHoldsSql('queued.issuer', 'queued.actor_uid', capabilities)}`, [issuer, id])).rowCount)
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    id = await vendorAccount(pool, ['customer_success', 'operations'])
  })
  afterAll(async () => { await pool.end() })

  it('grants exactly what the roles give, in code and in SQL', async () => {
    expect(await actorHolds(pool, actor(), ['vendor.tenants.manage', 'vendor.operations.run'])).toBe(true)
    expect(await sqlHolds(['vendor.tenants.manage', 'vendor.operations.run'])).toBe(true)
    expect(await actorHolds(pool, actor(), ['vendor.billing.manage'])).toBe(false)
    expect(await sqlHolds(['vendor.billing.manage'])).toBe(false)
  })
  it('loses authority at every recheck when a role is removed, with no sync step', async () => {
    await replaceRoles(pool, id, ['support'])
    expect(await actorHolds(pool, actor(), ['vendor.operations.run'])).toBe(false)
    expect(await sqlHolds(['vendor.operations.run'])).toBe(false)
    await expect(transaction(pool, (c) => requireOnboardingAuthority(c, actor()))).rejects.toThrow('shared_onboarding_forbidden')
    await expect(transaction(pool, (c) => requireJobAuthority(c, '00000000-0000-4000-8000-000000000001', actor()))).rejects.toThrow('shared_job_forbidden')
  })
  it('loses authority at every recheck when the account is disabled', async () => {
    await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [id])
    expect(await actorHolds(pool, actor(), ['vendor.operations.run'])).toBe(false)
    expect(await sqlHolds(['vendor.operations.run'])).toBe(false)
    await expect(transaction(pool, (c) => requireOnboardingAuthority(c, actor()))).rejects.toThrow('shared_onboarding_forbidden')
    await expect(transaction(pool, (c) => requireJobAuthority(c, '00000000-0000-4000-8000-000000000001', actor()))).rejects.toThrow('shared_job_forbidden')
  })
  it('never lets a system actor with the same number borrow a vendor account', async () => {
    const system = { issuer: 'vendor-scratch:commercial-fulfillment', actorUid: id }
    expect(await actorHolds(pool, system, ['vendor.operations.run'])).toBe(false)
    expect(await actorHolds(pool, { issuer: 'vendor-scratch', actorUid: id }, ['vendor.operations.run'])).toBe(false)
  })
  it('spells a vendor actor one way in audit rows', () => {
    expect(actorLabel(actor())).toBe(`account:${id}`)
    expect(actorLabel({ issuer: 'legacy-migration', actorUid: 1 })).toBe('legacy-migration:1')
  })
})
