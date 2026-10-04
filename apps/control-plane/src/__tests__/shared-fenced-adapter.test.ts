// Package-3 live evidence: the physically fenced adapter rejects a stale
// worker at the storage boundary even when the worker's own ownership
// callback lies. Runs against real loopback PostgreSQL: the control scratch
// database plus the authorized tenant scratch databases (empty schema only).
// Gated on CONTROL_TEST_DATABASE_URL; never touches odoo19 or any
// non-scratch database. This proves fencing semantics, not a production
// Docker adapter, Odoo, or deployment.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { runSharedJob, expireSharedLeases } from '../shared/job-worker.js'
import { createFencedStorageAdapter, ensureTenantStorageSchema, type TenantStorage } from '../shared/fenced-adapter.js'
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const tenantDatabases = url ? tenantDatabaseNames(2, url) : []
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('fenced adapter live PostgreSQL integration (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('fenced adapter live PostgreSQL integration', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  const tenantUrl = (database: string) => { const u = new URL(url); u.pathname = `/${database}`; return u.toString() }
  const connect = async (database: string): Promise<TenantStorage> => ({ pool: new Pool({ connectionString: tenantUrl(database), max: 1 }) })
  const adapter = createFencedStorageAdapter({ controlPool: pool, connect })
  const issuer = 'live-gate-installation'
  const actor = { issuer, actorUid: 7 }
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const tenantPools = new Map<string, Pool>()
  let registryDir = ''
  const bindingFor = (index: number) => {
    const nn = String(index + 1).padStart(2, '0')
    return { host: `t${nn}.fenced.invalid`, tenantId: `t${nn}`, database: tenantDatabases[index]!, filestore: tenantDatabases[index]!, enabled: true, registryRevision: 1 }
  }

  beforeAll(async () => {
    registryDir = process.env.NASQ_LIVE_GATE_ROOT
      ? join(process.env.NASQ_LIVE_GATE_ROOT, 'fenced')
      : await mkdtemp(join(tmpdir(), 'nasq-fenced-'))
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    await ensureTenantDatabases(pool, tenantDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_memberships, service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await pool.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ($1,7,$2)', [issuer, ['vendor.read','vendor.tenants.manage','vendor.operations.run']])
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true),($4,$5,\'saas\',\'managed\',$6,\'live-v1\',\'core\',true)',
      [tenantA, 'Fenced A', 'fenced-a', tenantB, 'Fenced B', 'fenced-b'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    const registryPath = join(registryDir, 'registry.json')
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantA, expectedSnapshotRevision: 0, target: bindingFor(0), reason: 'Fenced tenant A' })
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantB, expectedSnapshotRevision: 1, target: bindingFor(1), reason: 'Fenced tenant B' })
    for (const database of tenantDatabases) {
      const storage = await connect(database)
      await ensureTenantStorageSchema(storage)
      await storage.pool.query('TRUNCATE shared_fencing, shared_effects, shared_tenant_policy')
      await storage.pool.end()
      tenantPools.set(database, new Pool({ connectionString: tenantUrl(database) }))
    }
  })
  afterAll(async () => {
    for (const database of tenantDatabases) await tenantPools.get(database)!.end()
    await pool.end()
    if (!process.env.NASQ_LIVE_GATE_ROOT) await rm(registryDir, { recursive: true, force: true })
  })

  const effectsIn = async (index: number) =>
    (await tenantPools.get(tenantDatabases[index])!.query('SELECT tenant_id, business_key, attempt_id::text AS attempt_id, fence::float8 AS fence, payload_digest FROM shared_effects')).rows as Record<string, unknown>[]
  const effectsCount = async (index: number) =>
    Number((await tenantPools.get(tenantDatabases[index])!.query('SELECT count(*)::int AS count FROM shared_effects')).rows[0].count)

  it('applies each tenant effect exactly once through the real worker with the fenced adapter', async () => {
    const jobA = await enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Fenced provision A')
    const jobB = await enqueueSharedJob(pool, tenantB, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Fenced provision B')
    const [resultA, resultB] = await Promise.all([
      runSharedJob(pool, jobA.id, adapter),
      runSharedJob(pool, jobB.id, adapter),
    ])
    if (resultA.state !== 'verified' || resultB.state !== 'verified') throw new Error(`unexpected worker state: ${resultA.state}/${resultB.state}`)
    const receiptA = (resultA as { receipt: { attemptId: string; payloadDigest: string } }).receipt
    const rowsA = await effectsIn(0)
    const rowsB = await effectsIn(1)
    expect(rowsA).toHaveLength(1)
    expect(rowsB).toHaveLength(1)
    expect(rowsA[0]!.tenant_id).toBe('t01')
    expect(rowsB[0]!.tenant_id).toBe('t02')
    // Each effect landed only in its own tenant database, never the neighbour's.
    expect(rowsA[0]!.payload_digest).toBe(receiptA.payloadDigest)
    expect(await effectsCount(1)).toBe(1)
    expect(rowsA[0]!.attempt_id).toBe(receiptA.attemptId)
    // The verified provision effect wrote the policy derived from the job payload
    // (server-side catalog policy), in the same tenant transaction.
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [jobA.id])).rows[0].payload
    const policy = (await tenantPools.get(tenantDatabases[0])!.query('SELECT policy_revision::float8 AS revision,features FROM shared_tenant_policy WHERE tenant_id=$1', ['t01'])).rows
    expect(policy).toHaveLength(1)
    expect(Number(policy[0].revision)).toBe(1)
    expect(policy[0].features).toEqual(stored.policy.features)
  })

  it('observes a provision as verified only when the policy row matches', async () => {
    const { rows } = await pool.query("SELECT payload FROM shared_jobs WHERE business_key=$1 AND payload->'binding'->>'tenantId'='t01'", [JSON.stringify(['shared-v1', 't01', 'provision', 'initial'])])
    const job = rows[0].payload
    const db = tenantPools.get(tenantDatabases[0])!
    expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: true })
    const saved = (await db.query('SELECT policy_revision::float8 AS revision,features FROM shared_tenant_policy WHERE tenant_id=$1', ['t01'])).rows[0]
    try {
      await db.query("UPDATE shared_tenant_policy SET features='{\"forged.feature\": true}'::jsonb WHERE tenant_id='t01'")
      expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: false })
      await db.query('DELETE FROM shared_tenant_policy WHERE tenant_id=$1', ['t01'])
      expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: false })
    } finally {
      await db.query('DELETE FROM shared_tenant_policy WHERE tenant_id=$1', ['t01'])
      await db.query('INSERT INTO shared_tenant_policy(tenant_id,policy_revision,features) VALUES($1,$2,$3::jsonb)', ['t01', saved.revision, JSON.stringify(saved.features)])
    }
    expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: true })
  })

  it('stays verified after a policy-revision bump (provisioned-then-updated)', async () => {
    const { rows } = await pool.query("SELECT payload FROM shared_jobs WHERE business_key=$1 AND payload->'binding'->>'tenantId'='t02'", [JSON.stringify(['shared-v1', 't02', 'provision', 'initial'])])
    const job = rows[0].payload
    const db = tenantPools.get(tenantDatabases[1])!
    const saved = (await db.query('SELECT policy_revision::float8 AS revision,features FROM shared_tenant_policy WHERE tenant_id=$1', ['t02'])).rows[0]
    expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: true })
    try {
      // A later policy-revision bump must not make an already-verified
      // provision observe as unverified: the provision effect's identity is
      // "the initial policy was written", so a higher revision is
      // provisioned-then-updated, not a foreign effect.
      await db.query('UPDATE shared_tenant_policy SET policy_revision=2 WHERE tenant_id=$1', ['t02'])
      expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: true })
    } finally {
      await db.query('UPDATE shared_tenant_policy SET policy_revision=$1 WHERE tenant_id=$2', [saved.revision, 't02'])
    }
    expect(await adapter.observe(job)).toMatchObject({ state: 'present', verified: true })
  })

  it('rejects a forged caller policy at enqueue', async () => {
    await expect(enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID(), policy: { schema_version: 1, channel: 'control_plane', modules: ['nasq_core'], features: { 'forged.enabled': true } } }, 'Forged policy'))
      .rejects.toThrow()
  })

  it('re-applies idempotently for the same live attempt and rejects a different attempt', async () => {
    const backup = await enqueueSharedJob(pool, tenantB, actor, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Idempotency backup')
    const attempt = randomUUID()
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2 AND state='queued'", [attempt, backup.id])
    const jobs = await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [backup.id])
    const job = jobs.rows[0].payload
    // First application writes the effect; same attempt re-apply is a no-op.
    await adapter.applyFenced({ job, attemptId: attempt, fence: 1, assertOwned: async () => {} })
    await adapter.applyFenced({ job, attemptId: attempt, fence: 1, assertOwned: async () => {} })
    const rows = (await tenantPools.get(tenantDatabases[1])!.query('SELECT count(*)::int AS count FROM shared_effects WHERE attempt_id=$1', [attempt])).rows
    expect(Number(rows[0].count)).toBe(1)
    // A different (forged) attempt is rejected by the authority store.
    await expect(adapter.applyFenced({ job, attemptId: randomUUID(), fence: 1, assertOwned: async () => {} }))
      .rejects.toMatchObject({ code: 'stale_fence' })
    const after = (await tenantPools.get(tenantDatabases[1])!.query('SELECT count(*)::int AS count FROM shared_effects WHERE attempt_id=$1', [attempt])).rows
    expect(Number(after[0].count)).toBe(1)
  })

  it('physically rejects the stale owner after lease expiry even when the ownership callback lies', async () => {
    const backup = await enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Backup for stale test')
    const crashedAttempt = randomUUID()
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2 AND state='queued'", [crashedAttempt, backup.id])
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [backup.id])
    const expired = await expireSharedLeases(pool)
    expect(expired).toBeGreaterThanOrEqual(1)
    const quarantined = await pool.query('SELECT state,fence::float8 AS fence,attempt_id::text AS attempt_id FROM shared_jobs WHERE id=$1', [backup.id])
    expect(quarantined.rows[0].state).toBe('needs_intervention')
    expect(Number(quarantined.rows[0].fence)).toBe(2)
    // The stale worker returns with its old attempt and old fence, and its
    // assertOwned callback is a no-op that always succeeds. The adapter must
    // still reject at the storage boundary and write nothing.
    const jobs = await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [backup.id])
    const job = jobs.rows[0].payload
    const before = await effectsCount(0)
    const neighbourBefore = await effectsCount(1)
    await expect(adapter.applyFenced({ job, attemptId: crashedAttempt, fence: 1, assertOwned: async () => {} }))
      .rejects.toMatchObject({ code: 'stale_fence' })
    expect(await effectsCount(0)).toBe(before)
    // A forged current-fence attempt is rejected identically.
    await expect(adapter.applyFenced({ job, attemptId: randomUUID(), fence: 2, assertOwned: async () => {} }))
      .rejects.toMatchObject({ code: 'stale_fence' })
    expect(await effectsCount(0)).toBe(before)
    // And nothing leaked into the neighbour database.
    expect(await effectsCount(1)).toBe(neighbourBefore)
  })

  it('keeps tenant fences monotonic across jobs in the same tenant database', async () => {
    const fencing = (await tenantPools.get(tenantDatabases[0])!.query('SELECT fence::float8 AS fence FROM shared_fencing WHERE tenant_id=\'t01\'')).rows[0]
    expect(Number(fencing.fence)).toBeGreaterThanOrEqual(1)
    // Cross-tenant containment of the whole run.
    for (const [index, database] of tenantDatabases.entries()) {
      const rows = (await tenantPools.get(database)!.query('SELECT tenant_id FROM shared_effects')).rows as { tenant_id: string }[]
      for (const row of rows) expect(row.tenant_id).toBe(`t${String(index + 1).padStart(2, '0')}`)
    }
  })
})
