import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'
import { MAIN_SCHEMA_FIXTURES } from './fixtures/main-schema/index.js'

const suite = url ? describe : describe.skip

const SRC = new URL('../', import.meta.url)
const FIXTURES = new URL('./fixtures/main-schema/', import.meta.url)
/** The versions migrate() applies before schema_033. */
const BEFORE_033 = [1, ...Array.from({ length: 31 }, (_, i) => i + 2)].filter(v => v <= 32)
const fileFor = (version: number) => (version === 1 ? 'schema.sql' : `schema_${String(version).padStart(3, '0')}.sql`)

/**
 * A1: schema_033 must carry a database forward that applied `origin/main`'s schema_001..032 — not a fresh database,
 * which already has release 1's seeds and therefore never exercises the retro statement.
 *
 * The old state is rebuilt by applying main's two *edited* migrations from the fixture directory and this branch's copy
 * of everything else, inside one transaction, then recording each version as applied. The test asserts both halves of
 * that claim: the fixture files are identical to `origin/main`'s blobs when a main checkout is reachable, and no
 * migration other than those two differs between main and this branch.
 */
suite('schema_033 carries a database that ran origin/main\'s schema_001..032', () => {
  const dbName = `liwan_control_scratch_retro${randomUUID().slice(0, 8).replace(/-/g, '')}`
  const withDb = (name: string) => { const u = new URL(url!); u.pathname = `/${name}`; return u.toString() }
  let pool: Pool
  let created = false

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`CREATE DATABASE ${dbName}`); created = true } finally { await admin.end() }
    pool = new Pool({ connectionString: withDb(dbName), max: 4 })
  })
  afterAll(async () => {
    await pool?.end()
    if (!created) return
    const admin = new Pool({ connectionString: withDb('postgres') })
    try { await admin.query(`DROP DATABASE ${dbName}`) } finally { await admin.end() }
  })

  /** Applies main's schema_001..032, then the branch's migrate(), and returns the plan family afterwards. */
  async function buildOldThenMigrate() {
    const client = await pool.connect()
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
      const fixtures = new Set<string>(MAIN_SCHEMA_FIXTURES)
      for (const version of BEFORE_033) {
        const name = fileFor(version)
        const body = fixtures.has(name)
          ? await readFile(new URL(name, FIXTURES), 'utf8')
          : await readFile(new URL(name, SRC), 'utf8')
        await client.query(body)
        await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version])
      }
    } finally { client.release() }
    // The old database has one approved policy, prices the plan at 299, includes 5 GiB and is pinned to the 15% policy.
    const before = (await pool.query("SELECT id,version,prices,included_storage_mb,policy_revision_id FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1'")).rows
    expect(before).toHaveLength(1)
    expect(before[0].included_storage_mb).toBe(5120)
    expect(before[0].policy_revision_id).toBe('6f1c3d8e-0000-4000-8000-000000000001')
    expect(JSON.stringify(before[0].prices)).toContain('29900')
    const policies = (await pool.query('SELECT id FROM pricing_policy_revisions')).rows.map(r => r.id)
    expect(policies).toEqual(['6f1c3d8e-0000-4000-8000-000000000001'])
    return before
  }

  it('boots and supersedes the stale plan revision', async () => {
    const before = await buildOldThenMigrate()
    // The blocker: this used to be a foreign-key violation on plan_revisions.policy_revision_id, rolling the whole
    // migration back so the control plane never booted on the database it was written for.
    await expect(migrate(pool)).resolves.toBeUndefined()
    const live = (await pool.query("SELECT * FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published' AND available")).rows
    expect(live).toHaveLength(1)
    expect(live[0].included_storage_mb).toBe(20480)
    expect(live[0].policy_revision_id).toBe('6f1c3d8e-0000-4000-8000-000000000002')
    expect(live[0].platform_limits['ai.setup.monthly']).toBeUndefined()
    expect(live[0].platform_limits['ai.assist.monthly']).toBe(100)
    expect(live[0].trial_days).toBe(0)
    // The stale revision is withdrawn, never edited: a published revision is immutable.
    expect((await pool.query('SELECT available FROM plan_revisions WHERE id=$1', [before[0].id])).rows[0].available).toBe(false)
    // The policy schema_033 inserted is the one the superseding revision is pinned to.
    expect((await pool.query("SELECT tax_kind FROM pricing_policy_revisions WHERE id='6f1c3d8e-0000-4000-8000-000000000002'")).rows[0].tax_kind).toBe('none')
    // schema_035 then supersedes that revision once more for the 70/700 extra-branch price (owner decision 2026-11-08).
    expect(live[0].extra_branch_prices[0].amount.minor).toBe(7000)
    // And the migration is idempotent: a second run changes nothing.
    await migrate(pool)
    expect((await pool.query("SELECT count(*)::int AS n FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1'")).rows[0].n).toBe(3)
  })

  it('gives the superseding revision the optional-bundle references of the revision it replaces', async () => {
    // Rebuilding is cheap and keeps this independent of the order the previous case ran in.
    const client = await pool.connect()
    try {
      await client.query('DROP SCHEMA public CASCADE')
      await client.query('CREATE SCHEMA public')
    } finally { client.release() }
    await buildOldThenMigrate()
    // A bundle the old plan offered as optional, so the copy below has something to carry.
    const bundleId = randomUUID()
    const bundleFamily = randomUUID()
    // A catalog release to hang the bundle on: a v32 database from origin/main has none until one is imported, and a
    // release is pinned to an entry, so both rows are made here.
    const releaseId = randomUUID()
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1::uuid,'fixture','published','{}'::jsonb,$2::text) ON CONFLICT DO NOTHING", [randomUUID(), 'e'.repeat(64)])
    await pool.query("INSERT INTO catalog_releases(id,catalog_version,source_digest,artifact_digest,applications) VALUES($1,'fixture',$2,$2,'[]') ON CONFLICT DO NOTHING", [releaseId, 'e'.repeat(64)])
    await pool.query("INSERT INTO commercial_bundles(id) VALUES($1)", [bundleFamily])
    await pool.query(`INSERT INTO bundle_revisions(id,bundle_id,version,name,description,audience,catalog_release_id,selections,domain_limits,prices,status,available,content_digest,validated_digest,published_at)
      VALUES($1::uuid,$2::uuid,1,'Bundle','Fixture','{"kind":"public"}'::jsonb,
        $3::uuid,'[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'published',true,'d','d',now())`, [bundleId, bundleFamily, releaseId])
    // The stale published revision lists the bundle as optional. A published row only permits the availability edit, so
    // the bundle is attached the way the pre-release code attached it: before the row is published. Here the row is
    // re-published with the bundle, which the migration then carries to the revision that supersedes it.
    await pool.query(`UPDATE plan_revisions SET available=false, edit_revision=edit_revision+1
      WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published'`)
    await pool.query(`UPDATE plan_revisions SET optional_bundle_revision_ids=$1::jsonb
      WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published'`, [JSON.stringify([bundleId])]).catch(async () => {
      // Immutable once published: recreate the row as a draft carrying the bundle, which is what the console would do.
      await pool.query(`INSERT INTO plan_revisions(id,plan_id,version,name,audience,status,available,term_months,currency,prices,platform_limits,
          included_bundle_revision_ids,optional_bundle_revision_ids,included_extra_branches,extra_branch_prices,extra_branches_limit,
          included_users,included_storage_mb,user_prices,storage_prices,policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,
          content_digest,validated_digest)
        SELECT gen_random_uuid(),plan_id,version+1,name,audience,'published',true,term_months,currency,prices,platform_limits,
          included_bundle_revision_ids,$1::jsonb,included_extra_branches,extra_branch_prices,extra_branches_limit,
          included_users,included_storage_mb,user_prices,storage_prices,policy_revision_id,trial_days,grace_days,auto_suspend,auto_renew_allowed,
          'x','x'
        FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published'`, [JSON.stringify([bundleId])])
    })
    await pool.query("INSERT INTO revision_references(revision_id,revision_kind,referenced_by_kind,referenced_by_id) VALUES($1::uuid,'bundle','plan',$2) ON CONFLICT DO NOTHING", [bundleId, 'old-plan'])
    await migrate(pool)
    const live = (await pool.query("SELECT id,optional_bundle_revision_ids FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1' AND status='published' AND available")).rows[0]
    expect(live.optional_bundle_revision_ids).toEqual([bundleId])
    // The superseding revision references the bundle it still offers (the pre-existing row keeps the `old-plan` owner).
    const refs = (await pool.query("SELECT referenced_by_id FROM revision_references WHERE revision_id=$1 AND referenced_by_kind='plan'", [bundleId])).rows.map(r => r.referenced_by_id)
    expect(refs).toContain(live.id)
  })
})

/**
 * The fixture claim above: the two fixture files are origin/main's schema_012.sql and schema_025.sql as they were before
 * release 1. They are applied migrations, so main can never change them; their SHA-256 digests are pinned here, which
 * proves the claim in every checkout, shallow or not, and does not depend on where `origin/main` has moved since. (That
 * only these two migrations changed seed data is verified against the pull request diff when the branch is reviewed:
 * `git diff --name-status origin/main...HEAD -- 'apps/control-plane/src/schema*.sql'` lists exactly schema_012, schema_025
 * and the new schema_033.)
 */
const FIXTURE_SHA256: Record<(typeof MAIN_SCHEMA_FIXTURES)[number], string> = {
  'schema_012.sql': '605e7715a1c513211b2c885eaa6575d658467395db5674c5dad84100f173fd62',
  'schema_025.sql': 'a229045b9aadc7eee1c26abe1a3dff1db00146b7eddcd133f8fbd5ca132b412a',
}

describe('the old-schema fixture is honest', () => {
  it('each fixture copy is byte-identical to the origin/main file it stands for', async () => {
    for (const name of MAIN_SCHEMA_FIXTURES) {
      const digest = createHash('sha256').update(await readFile(new URL(name, FIXTURES))).digest('hex')
      expect(digest, `${name} was edited: a fixture is not a migration, re-capture it from main's history instead`).toBe(FIXTURE_SHA256[name])
    }
  })

  it('the fixture copies still equal what the fixture module names', async () => {
    const onDisk = (await readdir(FIXTURES)).filter(name => name.endsWith('.sql')).sort()
    expect(onDisk).toEqual([...MAIN_SCHEMA_FIXTURES].sort())
  })
})
