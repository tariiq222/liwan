// Package-4 live evidence: shared provision readiness and the activation
// gate. Real PostgreSQL across the control scratch DB and the authorized
// tenant scratch databases. The fenced adapter (package 3) provides the
// effect; this suite proves the activation decision: active ONLY after a
// durably verified job plus a fully passing independent inspection, an
// audited refusal otherwise, and a first administrator bound to the request
// identity with no password material anywhere. Gated on
// CONTROL_TEST_DATABASE_URL; never touches odoo19 or non-scratch databases.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { runSharedJob } from '../shared/job-worker.js'
import { createFencedStorageAdapter, ensureTenantStorageSchema, type TenantStorage } from '../shared/fenced-adapter.js'
import { bindJob, payloadDigest } from '../shared/provisioning.js'
import { bootstrapFirstAdmin, ensureAdminBindingSchema, inspectTenantReadiness, activateSharedTenant } from '../shared/provision-readiness.js'
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const tenantDatabases = url ? tenantDatabaseNames(2, url) : []
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('shared provision lifecycle (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared provision lifecycle', () => {
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
    return { host: `t${nn}.lifecycle.invalid`, tenantId: `t${nn}`, database: tenantDatabases[index]!, filestore: tenantDatabases[index]!, enabled: true, registryRevision: 1 }
  }

  beforeAll(async () => {
    registryDir = process.env.NASQ_LIVE_GATE_ROOT ? join(process.env.NASQ_LIVE_GATE_ROOT, 'lifecycle') : await mkdtemp(join(tmpdir(), 'nasq-lifecycle-'))
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    await ensureTenantDatabases(pool, tenantDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE shared_payment_events, shared_orders, shared_restore_approvals, shared_backups CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_memberships, service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await pool.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ($1,7,$2)', [issuer, ['vendor.read','vendor.tenants.manage','vendor.operations.run']])
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true),($4,$5,\'saas\',\'managed\',$6,\'live-v1\',\'core\',true)',
      [tenantA, 'Lifecycle A', 'lifecycle-a', tenantB, 'Lifecycle B', 'lifecycle-b'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    const registryPath = join(registryDir, 'registry.json')
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantA, expectedSnapshotRevision: 0, target: bindingFor(0), reason: 'Lifecycle tenant A' })
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantB, expectedSnapshotRevision: 1, target: bindingFor(1), reason: 'Lifecycle tenant B' })
    for (const database of tenantDatabases) {
      const storage = await connect(database)
      await ensureTenantStorageSchema(storage)
      await ensureAdminBindingSchema(storage)
      await storage.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
      await storage.pool.end()
      tenantPools.set(database, new Pool({ connectionString: tenantUrl(database) }))
    }
  })
  afterAll(async () => {
    for (const database of tenantDatabases) await tenantPools.get(database)!.end()
    await pool.end()
    if (!process.env.NASQ_LIVE_GATE_ROOT) await rm(registryDir, { recursive: true, force: true })
  })

  const tenantStatus = async (id: string) => (await pool.query('SELECT status FROM tenants WHERE id=$1', [id])).rows[0].status as string

  it('activates only after a verified job and a fully passing independent inspection', async () => {
    const requestId = randomUUID()
    const job = await enqueueSharedJob(pool, tenantA, actor, { schemaVersion: 1, operation: 'provision', requestId }, 'Lifecycle provision A')
    const result = await runSharedJob(pool, job.id, adapter)
    if (result.state !== 'verified') throw new Error(`provision not verified: ${result.state}`)
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [job.id])).rows[0].payload
    const digest = payloadDigest(bindJob(stored))
    const storage = await connect(tenantDatabases[0]!)
    try {
      await bootstrapFirstAdmin(storage, { tenantId: 't01', requestId, login: 'admin.t01', expectedEffectDigest: digest })
    } finally { await storage.pool.end() }
    const report = await inspectTenantReadiness(pool, connect, tenantA)
    expect(report.ready).toBe(true)
    expect(report.checks.map(c => c.name).sort()).toEqual(['database_connectivity', 'first_admin_bound', 'initial_policy', 'policy_modules', 'provision_job_verified', 'provision_operation', 'provisioned_effect', 'storage_fence'].sort())
    expect(report.checks.every(c => c.passed)).toBe(true)
    const activation = await activateSharedTenant(pool, tenantA, report, actor)
    expect(activation.activated).toBe(true)
    expect(await tenantStatus(tenantA)).toBe('active')
    const audit = (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='tenant.activated' AND subject=$1", [tenantA])).rows[0].count
    expect(Number(audit)).toBe(1)
    // The verified provision effect must have written the initial policy into
    // the tenant storage, derived from the job payload's server-side catalog
    // policy (never from the caller): revision >= 1 and non-empty features.
    const policyRow = (await tenantPools.get(tenantDatabases[0]!)!.query('SELECT policy_revision::float8 AS revision, features FROM shared_tenant_policy WHERE tenant_id=$1', ['t01'])).rows[0]
    expect(Number(policyRow.revision)).toBeGreaterThanOrEqual(1)
    expect(Object.keys(policyRow.features ?? {}).length).toBeGreaterThan(0)
    const payloadPolicy = (stored as { policy: { features: Record<string, unknown> } }).policy
    expect(policyRow.features).toEqual(payloadPolicy.features)
    // AC-06: the admin binding stores identity only — no password column exists.
    const columns = (await tenantPools.get(tenantDatabases[0]!)!.query("SELECT column_name FROM information_schema.columns WHERE table_name='shared_admin'")).rows.map((r: { column_name: string }) => r.column_name)
    expect([...columns].sort()).toEqual(['bound_at', 'login', 'request_id', 'tenant_id'])
    expect(columns.some(c => /pass|secret|token/i.test(c))).toBe(false)
  })

  it('fails closed with a named initial_policy check when the initial policy record is missing', async () => {
    // Remove the policy row the provision effect wrote; the gate must refuse
    // activation on a named check, never activate on modules alone.
    const database = tenantDatabases[0]!
    const removed = (await tenantPools.get(database)!.query('DELETE FROM shared_tenant_policy WHERE tenant_id=$1 RETURNING policy_revision::float8 AS revision, features', ['t01'])).rows[0]
    expect(removed).toBeDefined()
    try {
      const report = await inspectTenantReadiness(pool, connect, tenantA)
      expect(report.ready).toBe(false)
      const check = report.checks.find(c => c.name === 'initial_policy')
      expect(check).toBeDefined()
      expect(check!.passed).toBe(false)
      const activation = await activateSharedTenant(pool, tenantA, report, actor)
      expect(activation.activated).toBe(false)
      const refusal = (await pool.query("SELECT metadata FROM audit_events WHERE action='tenant.activation_refused' AND subject=$1 ORDER BY created_at DESC LIMIT 1", [tenantA])).rows[0].metadata
      expect(refusal.failed).toContain('initial_policy')
    } finally {
      // Test-setup restore of the exact deleted row so later suites see the
      // provisioned state again; the gate above was proven by the failing case.
      await tenantPools.get(database)!.query('INSERT INTO shared_tenant_policy(tenant_id,policy_revision,features) VALUES($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING', ['t01', removed.revision, JSON.stringify(removed.features)])
    }
  })

  it('refuses activation with an audited refusal and never a false active', async () => {
    const job = await enqueueSharedJob(pool, tenantB, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Lifecycle provision B')
    // Not executed: the readiness inspection must fail on the unverified job
    // and the missing effect, and activation must refuse.
    const storage = await connect(tenantDatabases[1]!)
    try { await bootstrapFirstAdmin(storage, { tenantId: 't02', requestId: randomUUID(), login: 'admin.t02', expectedEffectDigest: 'a'.repeat(64) }) } catch (error) { expect(String(error)).toContain('admin_binding_requires_verified_provision') } finally { await storage.pool.end() }
    const report = await inspectTenantReadiness(pool, connect, tenantB)
    expect(report.ready).toBe(false)
    expect(report.checks.find(c => c.name === 'provision_job_verified')?.passed).toBe(false)
    const activation = await activateSharedTenant(pool, tenantB, report, actor)
    expect(activation.activated).toBe(false)
    expect(await tenantStatus(tenantB)).toBe('needs_intervention')
    const refusal = (await pool.query("SELECT metadata FROM audit_events WHERE action='tenant.activation_refused' AND subject=$1", [tenantB])).rows[0].metadata
    expect(refusal.failed).toContain('provision_job_verified')
    expect(await tenantStatus(tenantA)).toBe('active')
  })

  it('recovers through the same gate after the failure is repaired — no blind retry, no bypassed activation', async () => {
    const stored = (await pool.query("SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1 AND business_key=$2", [tenantB, JSON.stringify(['shared-v1', 't02', 'provision', 'initial'])])).rows[0]
    const result = await runSharedJob(pool, stored.id, adapter)
    if (result.state !== 'verified') throw new Error(`recovery provision not verified: ${result.state}`)
    const digest = payloadDigest(bindJob(stored.payload))
    const requestId = (stored.payload as { requestId: string }).requestId
    const storage = await connect(tenantDatabases[1]!)
    try { await bootstrapFirstAdmin(storage, { tenantId: 't02', requestId, login: 'admin.t02', expectedEffectDigest: digest }) } finally { await storage.pool.end() }
    const report = await inspectTenantReadiness(pool, connect, tenantB)
    expect(report.ready).toBe(true)
    const activation = await activateSharedTenant(pool, tenantB, report, actor)
    expect(activation.activated).toBe(true)
    expect(await tenantStatus(tenantB)).toBe('active')
  })

  it('keeps each tenant admin binding in its own database only', async () => {
    for (const [index, database] of tenantDatabases.entries()) {
      const rows = (await tenantPools.get(database)!.query('SELECT tenant_id,login FROM shared_admin')).rows as { tenant_id: string; login: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].tenant_id).toBe(`t${String(index + 1).padStart(2, '0')}`)
      expect(rows[0].login).toBe(`admin.t${String(index + 1).padStart(2, '0')}`)
    }
  })
})
