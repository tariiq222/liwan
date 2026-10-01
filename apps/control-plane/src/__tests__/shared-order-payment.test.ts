// Package-6 live evidence: order and sandbox payment lifecycle on real
// PostgreSQL. An order carries an immutable quote; provider events are
// deduplicated per event id; a paid order links to exactly one provision
// job; reconciliation reports 'paid_not_ready' instead of a false success
// while the tenant is not durably active; cancelled/failed payments never
// provision. No real payment network is contacted — the sandbox provider is
// an explicit test double. Gated on CONTROL_TEST_DATABASE_URL.
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
import { ensureTenantDatabases, tenantDatabaseNames } from './live-tenant-databases.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const tenantDatabases = url ? tenantDatabaseNames(9, url).slice(7) : []
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1','localhost','::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
if (!url) describe.skip('shared order and sandbox payment lifecycle (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared order and sandbox payment lifecycle', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
  const tenantUrl = (database: string) => { const u = new URL(url); u.pathname = `/${database}`; return u.toString() }
  const connect = async (database: string): Promise<TenantStorage> => ({ pool: new Pool({ connectionString: tenantUrl(database), max: 1 }) })
  const adapter = createFencedStorageAdapter({ controlPool: pool, connect })
  const issuer = 'live-gate-installation'
  const actor = { issuer, actorUid: 7 }
  const tenantA = randomUUID()
  const tenantB = randomUUID()
  const quote = { schemaVersion: 1, currency: 'SAR', billingCycle: 'monthly', priceMinorUnits: 90000, taxMinorUnits: 13500, catalogVersion: 'live-v1', catalogTier: 'core' }

  beforeAll(async () => {
    const gateRoot = process.env.NASQ_LIVE_GATE_ROOT ?? await mkdtemp(join(tmpdir(), 'nasq-order-'))
    await mkdir(gateRoot, { recursive: true })
    await migrate(pool)
    await ensureTenantDatabases(pool, tenantDatabases)
    await pool.query('TRUNCATE shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE shared_payment_events, shared_orders, shared_restore_approvals, shared_backups CASCADE')
    await pool.query('TRUNCATE tenants CASCADE')
    await pool.query('TRUNCATE catalog_entries')
    await pool.query('TRUNCATE vendor_memberships, service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await pool.query('INSERT INTO vendor_memberships(issuer,actor_uid,capabilities) VALUES ($1,7,$2)', [issuer, ['vendor.read','vendor.tenants.manage','vendor.operations.run']])
    await pool.query('INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES ($1,$2,\'saas\',\'managed\',$3,true),($4,$5,\'saas\',\'managed\',$6,true)',
      [tenantA, 'Order A', 'order-a', tenantB, 'Order B', 'order-b'])
    const source = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    await pool.query('INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,\'live-v1\',\'published\',$2,$3,now())',
      [randomUUID(), JSON.parse(source.toString('utf8')), createHash('sha256').update(source).digest('hex')])
    const registryPath = join(gateRoot, 'order-registry.json')
    for (const [index, tenant] of [tenantA, tenantB].entries()) {
      const nn = String(index + 8).padStart(2, '0')
      await publishRegistryMutation(pool, registryPath, actor, { controlTenantId: tenant, expectedSnapshotRevision: index, target: { host: `t${nn}.order.invalid`, tenantId: `t${nn}`, database: tenantDatabases[index]!, filestore: tenantDatabases[index]!, enabled: true, registryRevision: 1 }, reason: `Order tenant ${nn}` })
      const storage = await connect(tenantDatabases[index]!)
      await ensureTenantStorageSchema(storage)
      await ensureAdminBindingSchema(storage)
      await storage.pool.query('TRUNCATE shared_fencing, shared_effects, shared_admin, shared_tenant_policy')
      await storage.pool.end()
    }
  })
  afterAll(async () => { await pool.end() })

  const orderStatus = async (id: string) => (await pool.query('SELECT status FROM shared_orders WHERE id=$1', [id])).rows[0].status as string

  it('creates an order once per idempotency key with an immutable quote', async () => {
    const key = 'checkout-' + randomUUID()
    const first = await createSharedOrder(pool, { controlTenantId: tenantA, idempotencyKey: key, quote })
    const second = await createSharedOrder(pool, { controlTenantId: tenantA, idempotencyKey: key, quote })
    expect(second.replay).toBe(true)
    expect(second.orderId).toBe(first.orderId)
    const stored = (await pool.query('SELECT quote FROM shared_orders WHERE id=$1', [first.orderId])).rows[0].quote
    expect(stored).toEqual(quote)
  })

  it('applies a provider event exactly once; duplicates never charge twice', async () => {
    const key = 'checkout-' + randomUUID()
    const order = await createSharedOrder(pool, { controlTenantId: tenantA, idempotencyKey: key, quote })
    const eventId = 'evt_' + randomUUID()
    const first = await applyPaymentEvent(pool, { orderId: order.orderId, providerEvent: { eventId, kind: 'payment_intent.succeeded' } })
    expect(first.firstSeen).toBe(true)
    expect(first.status).toBe('paid')
    const replayed = await applyPaymentEvent(pool, { orderId: order.orderId, providerEvent: { eventId, kind: 'payment_intent.succeeded' } })
    expect(replayed.firstSeen).toBe(false)
    expect(replayed.status).toBe('paid')
    const attempts = (await pool.query('SELECT payment_attempts::float8 AS attempts FROM shared_orders WHERE id=$1', [order.orderId])).rows[0].attempts
    expect(Number(attempts)).toBe(1)
    // Cancel and fail after payment never un-provision or re-open a paid order.
    const cancelKey = 'checkout-' + randomUUID()
    const cancelOrder = await createSharedOrder(pool, { controlTenantId: tenantB, idempotencyKey: cancelKey, quote })
    await applyPaymentEvent(pool, { orderId: cancelOrder.orderId, providerEvent: { eventId: 'evt_' + randomUUID(), kind: 'payment_intent.payment_failed' } })
    expect(await orderStatus(cancelOrder.orderId)).toBe('pending')
    await applyPaymentEvent(pool, { orderId: cancelOrder.orderId, providerEvent: { eventId: 'evt_' + randomUUID(), kind: 'payment_intent.canceled' } })
    expect(await orderStatus(cancelOrder.orderId)).toBe('cancelled')
    await expect(provisionPaidOrder(pool, { orderId: cancelOrder.orderId, actor })).rejects.toThrow('order_not_paid')
    // A cancelled order provisions nothing at all.
    const jobs = (await pool.query("SELECT count(*)::int AS count FROM shared_jobs WHERE control_tenant_id=$1", [tenantB])).rows[0].count
    expect(Number(jobs)).toBe(0)
  })

  it('links a paid order to exactly one provision job and converges on retries', async () => {
    const key = 'checkout-' + randomUUID()
    const order = await createSharedOrder(pool, { controlTenantId: tenantA, idempotencyKey: key, quote })
    await applyPaymentEvent(pool, { orderId: order.orderId, providerEvent: { eventId: 'evt_' + randomUUID(), kind: 'payment_intent.succeeded' } })
    const first = await provisionPaidOrder(pool, { orderId: order.orderId, actor })
    const retry = await provisionPaidOrder(pool, { orderId: order.orderId, actor })
    expect(retry.jobId).toBe(first.jobId)
    const jobs = (await pool.query("SELECT count(*)::int AS count FROM shared_jobs WHERE control_tenant_id=$1", [tenantA])).rows[0].count
    expect(Number(jobs)).toBe(1)
    // Provision through the real worker, bind the admin, activate, then reconcile.
    const result = await runSharedJob(pool, first.jobId, adapter)
    if (result.state !== 'verified') throw new Error(`order provision not verified: ${result.state}`)
    const stored = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [first.jobId])).rows[0].payload
    const storage = await connect(tenantDatabases[0]!)
    try { await bootstrapFirstAdmin(storage, { tenantId: 't08', requestId: stored.requestId, login: 'admin.t08', expectedEffectDigest: payloadDigest(bindJob(stored)) }) } finally { await storage.pool.end() }
    const report = await inspectTenantReadiness(pool, connect, tenantA)
    expect(report.ready).toBe(true)
    expect((await activateSharedTenant(pool, tenantA, report, actor)).activated).toBe(true)
    const reconciled = await reconcilePaidOrder(pool, order.orderId)
    expect(reconciled.status).toBe('provisioned')
  })

  it('reports paid_not_ready when the tenant is not durably active — never a false success', async () => {
    const key = 'checkout-' + randomUUID()
    const order = await createSharedOrder(pool, { controlTenantId: tenantB, idempotencyKey: key, quote })
    await applyPaymentEvent(pool, { orderId: order.orderId, providerEvent: { eventId: 'evt_' + randomUUID(), kind: 'payment_intent.succeeded' } })
    const provisioned = await provisionPaidOrder(pool, { orderId: order.orderId, actor })
    // The job runs and is verified, but activation is deliberately skipped
    // (the operator gate never ran): reconciliation must report the truth.
    const result = await runSharedJob(pool, provisioned.jobId, adapter)
    if (result.state !== 'verified') throw new Error(`provision not verified: ${result.state}`)
    const reconciled = await reconcilePaidOrder(pool, order.orderId)
    expect(reconciled.status).toBe('paid_not_ready')
    const status = await orderStatus(order.orderId)
    expect(status).toBe('paid_not_ready')
    // Tenant B was never activated by this suite's gate.
    const tenantStatus = (await pool.query('SELECT status FROM tenants WHERE id=$1', [tenantB])).rows[0].status
    expect(['registered', 'provisioning', 'needs_intervention']).toContain(tenantStatus)
  })
})
