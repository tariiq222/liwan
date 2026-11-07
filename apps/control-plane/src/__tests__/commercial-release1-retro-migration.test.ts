import { describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { readFile } from 'node:fs/promises'
const url = process.env.CONTROL_TEST_DATABASE_URL!
describe('schema_033 carries a pre-release development database forward', () => {
  it('supersedes a stale published plan with a release-1 revision', async () => {
    const pool = new Pool({ connectionString: url, max: 4 })
    await migrate(pool)
    // Make the database look like one seeded before release 1: the 299 base, 5 GiB, the VAT pin, a stale AI key.
    await pool.query("UPDATE plan_revisions SET available=false, edit_revision=edit_revision+1 WHERE plan_id='00000000-0000-4000-8000-0000000000b1'")
    await pool.query(`INSERT INTO plan_revisions(id,plan_id,version,name,audience,status,available,term_months,currency,prices,platform_limits,
      included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,extra_branch_prices,extra_branches_limit,included_users,included_storage_mb,
      user_prices,storage_prices,policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,content_digest,validated_digest,published_at)
      VALUES(gen_random_uuid(),'00000000-0000-4000-8000-0000000000b1',
        (SELECT max(version)+1 FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1'),'LiwanOS','{"kind":"public"}','published',true,12,'SAR',
        '[{"cadence":{"unit":"month","count":1},"amount":{"currency":"SAR","exponent":2,"minor":29900}}]'::jsonb,'{"ai.setup.monthly":50}'::jsonb,
        '[]','[]',0,'[]',NULL,3,5120,'[]','[]','6f1c3d8e-0000-4000-8000-000000000001',14,7,true,true,'d','d',now())`)
    const stale = (await pool.query("SELECT id,version FROM plan_revisions WHERE status='published' AND available")).rows[0]
    // Run the retroactive statement of schema_033 on its own: it is the part a database that already applied the
    // earlier half of 33 would re-run, and a fresh database skips it (its WHERE clause finds nothing).
    const sql = await readFile(new URL('../schema_033.sql', import.meta.url), 'utf8')
    const retro = sql.slice(sql.indexOf('-- The seed edits in schema_012.sql'))
    const client = await pool.connect()
    try { await client.query('BEGIN'); await client.query(retro); await client.query('COMMIT') } finally { client.release() }
    const live = (await pool.query("SELECT * FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published' AND available")).rows
    expect(live).toHaveLength(1)
    expect(live[0].version).toBe(Number(stale.version) + 1)
    expect(live[0].included_storage_mb).toBe(20480)
    expect(live[0].policy_revision_id).toBe('6f1c3d8e-0000-4000-8000-000000000002')
    expect(live[0].platform_limits['ai.setup.monthly']).toBeUndefined()
    expect(live[0].platform_limits['ai.messages.monthly']).toBe(500)
    expect(live[0].prices[0].amount.minor).toBe(0)
    expect((await pool.query('SELECT available FROM plan_revisions WHERE id=$1', [stale.id])).rows[0].available).toBe(false)
    await pool.end()
  })
})
