// Package-5 live evidence: shared backup and restore authority. Real
// PostgreSQL across the control scratch DB and the authorized tenant scratch
// databases. A backup record exists only after a consistent snapshot with
// independent readback verification; restore requires a separate operator
// approval, goes ONLY to a new (unmapped, empty) target database, is
// consumed exactly once, and the applied state is verified by readback.
// Gated on CONTROL_TEST_DATABASE_URL; never touches odoo19.
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
import { bootstrapFirstAdmin, ensureAdminBindingSchema, inspectTenantReadiness } from '../shared/provision-readiness.js'
import { createTenantBackup, approveSharedRestore, restoreBackupToNewTarget } from '../shared/shared-backup.js'
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const scratchDatabases = url ? tenantDatabaseNames(9, url) : []
const sourceDatabase = scratchDatabases[3] ?? ''
const targetDatabase = scratchDatabases[4] ?? ''
const reservedDatabase = scratchDatabases[5] ?? ''
const unverifiedDatabase = scratchDatabases[6] ?? ''
const preChangeTarget = scratchDatabases[7] ?? ''
const mismatchTarget = scratchDatabases[8] ?? ''
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('shared backup and restore authority (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared backup and restore authority', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  const tenantUrl = (database: string) => { const u = new URL(url); u.pathname = `/${database}`; return u.toString() }
  const connect = async (database: string): Promise<TenantStorage> => ({ pool: new Pool({ connectionString: tenantUrl(database), max: 1 }) })
  const adapter = createFencedStorageAdapter({ controlPool: pool, connect })
  const issuer = vendorActorIssuer('live-gate-installation')
  const actor = { issuer, actorUid: 7 }
  const tenantId = randomUUID()
  let backupRoot = ''
  let backupId = ''
  let registryPath = ''

  beforeAll(async () => {
    const gateRoot = process.env.NASQ_LIVE_GATE_ROOT ?? await mkdtemp(join(tmpdir(), 'nasq-backup-'))
    backupRoot = join(gateRoot, 'backups')
    await mkdir(backupRoot, { recursive: true })
    await migrate(pool)
    await ensureTenantDatabases(pool, scratchDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE shared_payment_events, shared_orders, shared_restore_approvals, shared_backups CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    await pool.query('TRUNCATE service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true)',
      [tenantId, 'Backup source', 'backup-source'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    registryPath = join(gateRoot, 'backup-registry.json')
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantId, expectedSnapshotRevision: 0, target: { host: 't04.backup.invalid', tenantId: 't04', database: sourceDatabase, filestore: sourceDatabase, enabled: true, registryRevision: 1 }, reason: 'Backup source tenant' })
    // Provision and bind the admin so the snapshot has meaningful content.
    const source0 = await connect(sourceDatabase)
    await ensureTenantStorageSchema(source0)
    await ensureAdminBindingSchema(source0)
    await source0.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
    await source0.pool.end()
    const requestId = randomUUID()
    const job = await enqueueSharedJob(pool, tenantId, actor, { schemaVersion: 1, operation: 'provision', requestId }, 'Backup source provision')
    const result = await runSharedJob(pool, job.id, adapter)
    if (result.state !== 'verified') throw new Error(`provision not verified: ${result.state}`)
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [job.id])).rows[0].payload
    const storage = await connect(sourceDatabase)
    try { await bootstrapFirstAdmin(storage, { tenantId: 't04', requestId, login: 'admin.t04', expectedEffectDigest: payloadDigest(bindJob(stored)) }) } finally { await storage.pool.end() }
    // Fresh, empty target database for the restore.
    const target = await connect(targetDatabase)
    await ensureTenantStorageSchema(target)
    await ensureAdminBindingSchema(target)
    await target.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
    await target.pool.end()
    // The restore-target fixtures must also start empty on reused scratch
    // databases (a prior run may have left rows behind).
    for (const fixture of [preChangeTarget, mismatchTarget]) {
      const t = await connect(fixture)
      await ensureTenantStorageSchema(t)
      await ensureAdminBindingSchema(t)
      await t.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
      await t.pool.end()
    }
  })
  afterAll(async () => { await pool.end() })

  it('records a backup only after consistent-capture readback verification', async () => {
    const record = await createTenantBackup(pool, connect, { controlTenantId: tenantId, backupRoot, createdBy: `${issuer}:7` })
    backupId = record.backupId
    expect(record.databaseSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(record.filestoreSha256).toMatch(/^[a-f0-9]{64}$/)
    const row = (await pool.query('SELECT consistency,tenant_id,database_name FROM shared_backups WHERE id=$1', [backupId])).rows[0]
    expect(row.consistency).toBe('verified')
    expect(row.tenant_id).toBe('t04')
    expect(row.database_name).toBe(sourceDatabase)
    const snap = (await pool.query('SELECT snapshot FROM shared_backups WHERE id=$1', [backupId])).rows[0].snapshot
    expect(snap.policy).toHaveLength(1)
    expect(snap.policy[0].policy_revision).toBeGreaterThanOrEqual(1)
    const artifact = await readFile(join(backupRoot, `${backupId}.json`), 'utf8')
    expect(createHash('sha256').update(artifact).digest('hex')).toBe(record.filestoreSha256)
    // Refuses to snapshot an unverified tenant (bound but never provisioned).
    const unverified = randomUUID()
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true)', [unverified, 'Unverified', 'unverified-target'])
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: unverified, expectedSnapshotRevision: 1, target: { host: 't99.backup.invalid', tenantId: 't99', database: unverifiedDatabase, filestore: unverifiedDatabase, enabled: true, registryRevision: 1 }, reason: 'Unverified fixture tenant' })
    await expect(createTenantBackup(pool, connect, { controlTenantId: unverified, backupRoot, createdBy: `${issuer}:7` })).rejects.toThrow('provision_not_verified')
  })

  it('restores to a NEW target only, once per approval, verified by readback', async () => {
    // The registry-mapped source database is never an eligible target.
    await expect(approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase: sourceDatabase, ttlSeconds: 3600, actor }))
      .rejects.toThrow('restore_target_reserved')
    const { approvalId } = await approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase, ttlSeconds: 3600, actor })
    const restored = await restoreBackupToNewTarget(pool, connect, { approvalId, actor })
    expect(restored.applied).toBe(true)
    expect(restored.databaseSha256).toMatch(/^[a-f0-9]{64}$/)
    // The restored target carries the source tenant's state, not another tenant's.
    const target = await connect(targetDatabase)
    try {
      const effects = (await target.pool.query('SELECT tenant_id FROM shared_effects')).rows as { tenant_id: string }[]
      const admin = (await target.pool.query('SELECT tenant_id,login FROM shared_admin')).rows as { tenant_id: string; login: string }[]
      expect(effects.every(r => r.tenant_id === 't04')).toBe(true)
      expect(admin).toHaveLength(1)
      expect(admin[0]!.login).toBe('admin.t04')
      // The policy round-trips: the restored tenant keeps revision and features.
      const src = await connect(sourceDatabase)
      try {
        const want = (await src.pool.query('SELECT tenant_id,policy_revision::float8 AS revision,features FROM shared_tenant_policy')).rows
        const got = (await target.pool.query('SELECT tenant_id,policy_revision::float8 AS revision,features FROM shared_tenant_policy')).rows
        expect(want).toHaveLength(1)
        expect(Number(got[0].revision)).toBeGreaterThanOrEqual(1)
        expect(Object.keys(got[0].features).length).toBeGreaterThan(0)
        expect(got).toEqual(want)
      } finally { await src.pool.end() }
    } finally { await target.pool.end() }
    // The approval is consumed exactly once.
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId, actor })).rejects.toThrow('restore_approval_unavailable')
    // A restore into the now non-empty target with a fresh approval is refused.
    const again = await approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase, ttlSeconds: 3600, actor })
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId: again.approvalId, actor })).rejects.toThrow('restore_target_not_empty')
  })

  it('rejects expired approvals and unauthorized actors', async () => {
    const expired = randomUUID()
    await pool.query('INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval \'1 second\')',
      [expired, backupId, tenantId, targetDatabase, 'Expired fixture approval'])
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId: expired, actor })).rejects.toThrow('restore_approval_unavailable')
    await expect(approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase: reservedDatabase, ttlSeconds: 3600, actor: { issuer, actorUid: 99 } }))
      .rejects.toThrow('shared_restore_forbidden')
  })

  it('restores a pre-change backup without a policy row and fails activation on initial_policy', async () => {
    // A backup taken before shared_tenant_policy existed: snapshot with no
    // `policy` key and a digest computed the old way (over exactly that shape).
    const src = await connect(sourceDatabase)
    let legacySnapshot: Record<string, unknown>
    try {
      const fencing = await src.pool.query('SELECT tenant_id,fence::float8 AS fence FROM shared_fencing ORDER BY tenant_id')
      const effects = await src.pool.query('SELECT tenant_id,business_key,payload_digest,attempt_id::text AS attempt_id,fence::float8 AS fence FROM shared_effects ORDER BY tenant_id,business_key')
      const admin = await src.pool.query('SELECT tenant_id,request_id::text AS request_id,login FROM shared_admin ORDER BY tenant_id')
      legacySnapshot = { schemaVersion: 1, tenantId: 't04', fencing: fencing.rows, effects: effects.rows, admin: admin.rows }
    } finally { await src.pool.end() }
    const legacyDigest = createHash('sha256').update(JSON.stringify(legacySnapshot)).digest('hex')
    const legacyBackupId = randomUUID()
    await pool.query(`INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by)
      VALUES($1,$2,'t04',$3,$3,$4,$5,$6,'legacy-fixture.json','verified',$7)`,
      [legacyBackupId, tenantId, sourceDatabase, JSON.stringify(legacySnapshot), legacyDigest, 'a'.repeat(64), `${issuer}:7`])
    const { approvalId } = await approveSharedRestore(pool, { backupId: legacyBackupId, controlTenantId: tenantId, targetDatabase: preChangeTarget, ttlSeconds: 3600, actor })
    const restored = await restoreBackupToNewTarget(pool, connect, { approvalId, actor })
    expect(restored.applied).toBe(true)
    // The restored target carries the fencing/effects/admin rows but NO policy.
    const target = await connect(preChangeTarget)
    let policyCount = -1
    try {
      policyCount = Number((await target.pool.query('SELECT count(*)::int AS count FROM shared_tenant_policy')).rows[0].count)
      expect(policyCount).toBe(0)
      expect(Number((await target.pool.query('SELECT count(*)::int AS count FROM shared_effects')).rows[0].count)).toBeGreaterThan(0)
      expect(Number((await target.pool.query('SELECT count(*)::int AS count FROM shared_admin')).rows[0].count)).toBe(1)
    } finally { await target.pool.end() }
    // The approval is consumed exactly once.
    const consumed = await pool.query('SELECT consumed_at FROM shared_restore_approvals WHERE id=$1', [approvalId])
    expect(consumed.rows[0].consumed_at).not.toBeNull()
    await expect(restoreBackupToNewTarget(pool, connect, { approvalId, actor })).rejects.toThrow('restore_approval_unavailable')
    // A restored tenant without a policy is fail-closed: the activation
    // readiness check reports initial_policy as failed.
    const restoreTenant = randomUUID()
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,\'live-v1\',\'core\',true)',
      [restoreTenant, 'Legacy restore target', 'legacy-restore'])
    const revision = Number((await pool.query('SELECT revision::int AS revision FROM shared_registry_state WHERE singleton')).rows[0].revision)
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: restoreTenant, expectedSnapshotRevision: revision, target: { host: 't09.legacy.invalid', tenantId: 't09', database: preChangeTarget, filestore: preChangeTarget, enabled: true, registryRevision: 1 }, reason: 'Legacy restore target binding' })
    const provisionJob = await enqueueSharedJob(pool, restoreTenant, actor, { schemaVersion: 1, operation: 'provision', requestId: randomUUID() }, 'Legacy restore readiness fixture')
    await pool.query("UPDATE shared_jobs SET state='verified',receipt='{\"schemaVersion\":1,\"status\":\"verified\"}'::jsonb WHERE id=$1", [provisionJob.id])
    const report = await inspectTenantReadiness(pool, connect, restoreTenant)
    expect(report.ready).toBe(false)
    expect(report.checks.find(c => c.name === 'initial_policy')).toMatchObject({ passed: false, detail: 'missing' })
  })

  it('rolls back the target and keeps the approval unconsumed on a readback mismatch', async () => {
    const { approvalId } = await approveSharedRestore(pool, { backupId, controlTenantId: tenantId, targetDatabase: mismatchTarget, ttlSeconds: 3600, actor })
    // Test hook tampers with the written state inside the tenant transaction,
    // before the in-transaction readback, forcing a digest mismatch.
    await expect(restoreBackupToNewTarget(pool, connect, {
      approvalId, actor,
      hooks: { beforeReadback: async tenant => { await tenant.query("INSERT INTO shared_fencing(tenant_id,fence) VALUES('tamper',99)") } },
    })).rejects.toThrow('restore_readback_mismatch')
    // The target stays completely empty: the tenant transaction rolled back.
    const target = await connect(mismatchTarget)
    let counts: Record<string, number>
    try {
      const rows = await target.pool.query(`SELECT (SELECT count(*)::int FROM shared_fencing) AS fencing,
        (SELECT count(*)::int FROM shared_effects) AS effects,
        (SELECT count(*)::int FROM shared_admin) AS admin,
        (SELECT count(*)::int FROM shared_tenant_policy) AS policy`)
      counts = rows.rows[0]
    } finally { await target.pool.end() }
    expect(counts).toEqual({ fencing: 0, effects: 0, admin: 0, policy: 0 })
    // The approval is unconsumed, so a retry with the same approval is possible.
    const approval = await pool.query('SELECT consumed_at FROM shared_restore_approvals WHERE id=$1', [approvalId])
    expect(approval.rows[0].consumed_at).toBeNull()
    const retried = await restoreBackupToNewTarget(pool, connect, { approvalId, actor })
    expect(retried.applied).toBe(true)
  })
})
