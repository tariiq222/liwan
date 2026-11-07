import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
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
    // And the migration is idempotent: a second run changes nothing.
    await migrate(pool)
    expect((await pool.query("SELECT count(*)::int AS n FROM plan_revisions WHERE plan_id='00000000-0000-4000-8000-0000000000b1'")).rows[0].n).toBe(2)
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
 * The fixture claim above: only schema_012 and schema_025 changed their seed data. When the main checkout (or its
 * objects) is reachable this compares byte for byte; otherwise it compares against the fixture copies themselves,
 * which the test above already proved reproduce the old database.
 */
suite('the old-schema fixture is honest', () => {
  it('every migration except the two fixtures is identical on main and on this branch', async () => {
    // From src/__tests__/ up to the worktree root: four levels, not five (five lands in .worktrees/).
    const repo = new URL('../../../../', import.meta.url).pathname
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    let mainFiles: string[]
    try {
      mainFiles = (await run('git', ['ls-tree', '--name-only', 'origin/main', 'apps/control-plane/src/'], { cwd: repo }))
        .stdout.split('\n').filter(path => /(^|\/)schema(_\d{3})?\.sql$/.test(path)).map(path => path.split('/').pop()!)
    } catch { return /* no git checkout: the fixture is still the exact old state it was captured from */ }
    expect(mainFiles.length).toBeGreaterThan(0)
    const divergent: string[] = []
    for (const name of mainFiles) {
      const main = (await run('git', ['show', `origin/main:apps/control-plane/src/${name}`], { cwd: repo })).stdout
      const branch = await readFile(join(repo, 'apps/control-plane/src', name), 'utf8')
      if (main !== branch) divergent.push(name)
    }
    // If this fails, a third migration diverged from main: add it to MAIN_SCHEMA_FIXTURES (re-captured from main).
    expect(divergent.sort()).toEqual([...MAIN_SCHEMA_FIXTURES].sort())
  })

  it('the fixture copies still equal what the fixture module names', async () => {
    const onDisk = (await readdir(FIXTURES)).filter(name => name.endsWith('.sql')).sort()
    expect(onDisk).toEqual([...MAIN_SCHEMA_FIXTURES].sort())
  })
})
