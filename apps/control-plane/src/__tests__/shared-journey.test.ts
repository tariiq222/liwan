// Package-7 live evidence: the complete shared-SaaS acceptance journey on
// real PostgreSQL, one synthetic tenant end to end:
// order (immutable quote) -> sandbox payment -> exactly one provision job ->
// fenced effect in the tenant database -> first-admin binding -> independent
// readiness inspection -> gated activation -> paid order reconciled to
// 'provisioned' -> verified backup -> approved restore into a NEW target
// database with readback verification.
// Gated on CONTROL_TEST_DATABASE_URL; never touches odoo19 or any real
// payment network. This is local acceptance evidence, not a launch approval.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { migrate } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { runSharedJob } from '../shared/job-worker.js'
import { createFencedStorageAdapter, ensureTenantStorageSchema, type TenantStorage } from '../shared/fenced-adapter.js'
import { bindJob, payloadDigest } from '../shared/provisioning.js'
import { bootstrapFirstAdmin, ensureAdminBindingSchema, inspectTenantReadiness, activateSharedTenant } from '../shared/provision-readiness.js'
import { createSharedOrder, applyPaymentEvent, provisionPaidOrder, reconcilePaidOrder } from '../shared/shared-order.js'
import { createTenantBackup, approveSharedRestore, restoreBackupToNewTarget } from '../shared/shared-backup.js'
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const scratchDatabases = url ? tenantDatabaseNames(10, url) : []
const sourceDatabase = scratchDatabases[9] ?? ''
const restoreTarget = scratchDatabases[5] ?? ''
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('shared SaaS full journey (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared SaaS full journey', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  const tenantUrl = (database: string) => { const u = new URL(url); u.pathname = `/${database}`; return u.toString() }
  const connect = async (database: string): Promise<TenantStorage> => ({ pool: new Pool({ connectionString: tenantUrl(database), max: 1 }) })
  const adapter = createFencedStorageAdapter({ controlPool: pool, connect })
  const issuer = 'live-gate-installation'
  const actor = { issuer, actorUid: 7 }
  const tenantId = randomUUID()
  const quote = { schemaVersion: 1, currency: 'SAR', billingCycle: 'yearly', priceMinorUnits: 1080000, taxMinorUnits: 162000, catalogVersion: 'live-v1', catalogTier: 'core' }
  let backupRoot = ''
  let registryPath = ''

  beforeAll(async () => {
    const gateRoot = process.env.NASQ_LIVE_GATE_ROOT ?? await mkdtemp(join(tmpdir(), 'nasq-journey-'))
    backupRoot = join(gateRoot, 'journey-backups')
    registryPath = join(gateRoot, 'journey-registry.json')
    await mkdir(backupRoot, { recursive: true })
    await migrate(pool)
    await ensureTenantDatabases(pool, scratchDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE shared_payment_events, shared_orders, shared_restore_approvals, shared_backups CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_memberships, service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await pool.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ($1,7,$2)', [issuer, ['vendor.read','vendor.tenants.manage','vendor.operations.run']])
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,true)',
      [tenantId, 'Journey tenant', 'journey-tenant'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenantId, expectedSnapshotRevision: 0, target: { host: 't10.journey.invalid', tenantId: 't10', database: sourceDatabase, filestore: sourceDatabase, enabled: true, registryRevision: 1 }, reason: 'Journey tenant' })
    for (const database of [sourceDatabase, restoreTarget]) {
      const storage = await connect(database)
      await ensureTenantStorageSchema(storage)
      await ensureAdminBindingSchema(storage)
      await storage.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
      await storage.pool.end()
    }
  })
  afterAll(async () => { await pool.end() })

  it('walks order -> payment -> provision -> activation -> backup -> restore with every gate holding', async () => {
    // 1. Order with an immutable quote.
    const order = await createSharedOrder(pool, { controlTenantId: tenantId, idempotencyKey: 'journey-' + randomUUID(), quote })
    expect(order.replay).toBe(false)
    // 2. Sandbox payment confirms exactly once.
    const payment = await applyPaymentEvent(pool, { orderId: order.orderId, providerEvent: { eventId: 'evt_' + randomUUID(), kind: 'payment_intent.succeeded' } })
    expect(payment.status).toBe('paid')
    // 3. Exactly one provision job, converging on retry.
    const provisioned = await provisionPaidOrder(pool, { orderId: order.orderId, actor })
    const again = await provisionPaidOrder(pool, { orderId: order.orderId, actor })
    expect(again.jobId).toBe(provisioned.jobId)
    // 4. Fenced effect in the tenant database.
    const result = await runSharedJob(pool, provisioned.jobId, adapter)
    if (result.state !== 'verified') throw new Error(`journey provision not verified: ${result.state}`)
    // 5. First-admin binding to the request identity.
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [provisioned.jobId])).rows[0].payload
    const storage = await connect(sourceDatabase)
    try { await bootstrapFirstAdmin(storage, { tenantId: 't10', requestId: stored.requestId, login: 'admin.t10', expectedEffectDigest: payloadDigest(bindJob(stored)) }) } finally { await storage.pool.end() }
    // 6. Independent readiness inspection passes fully.
    const report = await inspectTenantReadiness(pool, connect, tenantId)
    expect(report.ready).toBe(true)
    // 7. Gated activation.
    expect((await activateSharedTenant(pool, tenantId, report, actor)).activated).toBe(true)
    expect((await pool.query('SELECT status FROM tenants WHERE id=$1', [tenantId])).rows[0].status).toBe('active')
    // 8. The paid order reconciles to 'provisioned' — no paid_not_ready.
    expect((await reconcilePaidOrder(pool, order.orderId)).status).toBe('provisioned')
    // 9. Verified backup of the active tenant.
    const backup = await createTenantBackup(pool, connect, { controlTenantId: tenantId, backupRoot, createdBy: `${issuer}:7` })
    expect(backup.databaseSha256).toMatch(/^[a-f0-9]{64}$/)
    // 10. Approved restore into the NEW target, consumed once, readback-verified.
    const approval = await approveSharedRestore(pool, { backupId: backup.backupId, controlTenantId: tenantId, targetDatabase: restoreTarget, ttlSeconds: 3600, actor })
    const restored = await restoreBackupToNewTarget(pool, connect, { approvalId: approval.approvalId, actor })
    expect(restored.applied).toBe(true)
    const target = await connect(restoreTarget)
    try {
      const admin = (await target.pool.query('SELECT tenant_id,login FROM shared_admin')).rows as { tenant_id: string; login: string }[]
      expect(admin).toHaveLength(1)
      expect(admin[0]).toEqual({ tenant_id: 't10', login: 'admin.t10' })
    } finally { await target.pool.end() }
    // Full audit trail exists for the journey's gated decisions.
    const backupAudit = (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='shared_backup.verified' AND subject=$1", [backup.backupId])).rows[0].count
    const approvedAudit = (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='shared_restore.approved' AND subject=$1", [approval.approvalId])).rows[0].count
    const completedAudit = (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='shared_restore.completed' AND subject=$1", [approval.approvalId])).rows[0].count
    const activatedAudit = (await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE action='tenant.activated' AND subject=$1", [tenantId])).rows[0].count
    expect(Number(backupAudit)).toBe(1)
    expect(Number(approvedAudit)).toBe(1)
    expect(Number(completedAudit)).toBe(1)
    expect(Number(activatedAudit)).toBe(1)
    console.log('Journey complete: order->payment->provision->activation->backup->restore all gated and audited on live SQL. Synthetic upstream; no real Odoo/ACL/TLS/payment-network claim, not a launch approval.')
  })
})
