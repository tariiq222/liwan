import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url, money, monthly } from './commercial-helpers.js'

const suite = url ? describe : describe.skip

const PLAN = '00000000-0000-4000-8000-0000000000b1'
const YEAR = { unit: 'year' as const, count: 1 }
const branchPrices = (month: number, year: number) => [
  { cadence: monthly, amount: money(month) },
  { cadence: YEAR, amount: money(year) },
]

/**
 * Owner decision 2026-11-08: the extra branch of the release 1 plan costs 70 a month and 700 a year. schema_025 seeds it
 * for a fresh database; schema_035 supersedes a revision that still carries the earlier 50/500 price.
 */
suite('release 1 extra-branch price (schema_035)', () => {
  const dbName = `liwan_control_scratch_branchprice${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
    await migrate(pool)
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })

  const revisions = async () => (await pool.query('SELECT * FROM plan_revisions WHERE plan_id=$1 ORDER BY version', [PLAN])).rows
  const sellable = async () => (await pool.query("SELECT * FROM plan_revisions WHERE plan_id=$1 AND status='published' AND available", [PLAN])).rows
  /** schema_035 as migrate() runs it: one transaction, because the file keeps temp tables across statements. */
  async function runBranchPriceMigration() {
    const body = await readFile(new URL('../schema_035.sql', import.meta.url), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(body)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  it('a fresh database sells the plan with the extra branch at 70 a month and 700 a year', async () => {
    const live = await sellable()
    expect(live).toHaveLength(1)
    expect(live[0].extra_branch_prices).toEqual(branchPrices(7000, 70000))
    expect(live[0].user_prices).toEqual(branchPrices(2900, 29000))
    expect(live[0].storage_prices).toEqual(branchPrices(100, 1000))
    expect(live[0].prices).toEqual(branchPrices(0, 0))
  })

  it('supersedes a revision still priced at 50 a month with exactly one new revision', async () => {
    // The state of a database seeded before the decision: a newest sellable revision at 5000/50000. A published row only
    // permits the availability edit, so the older price is recreated as a new published revision, as the console would.
    const [current] = await sellable()
    await pool.query('UPDATE plan_revisions SET available=false, edit_revision=edit_revision+1 WHERE id=$1', [current.id])
    await pool.query(`INSERT INTO plan_revisions(id,plan_id,version,name,audience,status,available,term_months,currency,prices,platform_limits,
        included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,extra_branch_prices,extra_branches_limit,
        included_users,included_storage_mb,storage_step_mb,storage_step_threshold_mb,storage_large_step_mb,user_prices,storage_prices,
        policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,content_digest,validated_digest,published_at)
      SELECT $2::uuid,plan_id,version+1,name,audience,'published',true,term_months,currency,prices,platform_limits,
        included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,$3::jsonb,extra_branches_limit,
        included_users,included_storage_mb,storage_step_mb,storage_step_threshold_mb,storage_large_step_mb,user_prices,storage_prices,
        policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,'old','old',now()
      FROM plan_revisions WHERE id=$1`, [current.id, randomUUID(), JSON.stringify(branchPrices(5000, 50000))])
    const before = await revisions()
    const stale = (await sellable())[0]
    expect(stale.extra_branch_prices).toEqual(branchPrices(5000, 50000))

    await runBranchPriceMigration()

    const after = await revisions()
    expect(after).toHaveLength(before.length + 1)
    expect((await pool.query('SELECT available FROM plan_revisions WHERE id=$1', [stale.id])).rows[0].available).toBe(false)
    const live = await sellable()
    expect(live).toHaveLength(1)
    expect(live[0].version).toBe(Math.max(...before.map(r => r.version)) + 1)
    expect(live[0].extra_branch_prices).toEqual(branchPrices(7000, 70000))
    for (const column of ['prices', 'user_prices', 'storage_prices', 'platform_limits', 'included_users', 'included_storage_mb', 'policy_revision_id'] as const) {
      expect(live[0][column], column).toEqual(stale[column])
    }
  })

  it('writes nothing when the sellable revision already carries the new price', async () => {
    const before = await revisions()
    await runBranchPriceMigration()
    expect(await revisions()).toEqual(before)
  })
})
