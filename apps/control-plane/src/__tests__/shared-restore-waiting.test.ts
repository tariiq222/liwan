import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import type { SharedJob } from '@webvue/commercial-contracts/shared'
import { migrate } from '../db.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'
import { runSharedJob, type SharedFencedAdapter } from '../shared/job-worker.js'
import { dispatchSharedOnce } from '../shared/job-dispatcher.js'
import { commercialRestoreGate } from '../shared/shared-backup.js'
import type { ObserveRunner } from '../shared/subscription-reconcile.js'
import { url } from './commercial-helpers.js'
import { vendorAccount, replaceRoles } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

// Real scratch control PG; physical restore/reconfigure are fake readback receipts.
// No tenant database, Docker process, registry file, or production adapter is used.
if (url) {
  const target = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !/^\/webvue_control_scratch_[a-z0-9]+$/.test(target.pathname)) throw Error('loopback scratch control DB required')
}
describe.skipIf(!url)('shared restore waiting for commercial reconciliation', () => {
  const pool = new Pool({ connectionString: url, max: 10 })
  const issuer = vendorActorIssuer(`restore-waiting-${randomUUID()}`)
  const fixtureTenants: string[] = []
  afterEach(async () => {
    // Failed expected regressions may leave a queued repair; isolate the next
    // dispatch case without changing/deleting its immutable receipt evidence.
    for (const tenant of fixtureTenants.splice(0)) await pool.query('UPDATE tenants SET operations_enabled=false WHERE id=$1', [tenant])
  })
  beforeAll(async () => {
    await migrate(pool)
    await vendorAccount(pool, ['operations'], 7)
  })
  afterAll(() => pool.end())

  async function fixture(commercial: boolean) {
    const tenant = randomUUID(), backupId = randomUUID(), approval = randomUUID(), id = randomUUID()
    fixtureTenants.push(tenant)
    const slug = `t${tenant.replaceAll('-', '')}`, database = `webvue_scratch_${randomUUID().replaceAll('-', '')}`
    const restoredDatabase = `webvue_scratch_${randomUUID().replaceAll('-', '')}`
    const binding = { tenantId: slug, database, filestore: database, registryRevision: 1 }
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Waiting restore','saas','managed',$2,true)", [tenant, slug])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.invalid`, database])
    await pool.query("INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by) VALUES($1,$2,$3,$4,$4,'{}',$5,$6,'fake-backup','verified',$7)", [backupId, tenant, slug, database, 'a'.repeat(64), 'b'.repeat(64), issuer])
    await pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,'Waiting fixture',now()+interval '1 hour')", [approval, backupId, tenant, restoredDatabase])
    const job: Extract<SharedJob, { operation: 'restore' }> = {
      schemaVersion: 1, operation: 'restore', requestId: randomUUID(), approvalId: approval, binding,
      backup: { schemaVersion: 1, backupId, binding, databaseSha256: 'a'.repeat(64), filestoreSha256: 'b'.repeat(64), consistency: 'verified' },
    }
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,$4,$5,$6,7,'Waiting fixture')", [id, tenant, businessKey(job), job, payloadDigest(job), issuer])
    const applied = randomUUID(), older = randomUUID(), order = randomUUID()
    if (commercial) {
      const customer = randomUUID(), subscription = randomUUID()
      await pool.query("INSERT INTO customers(id,name,tenant_id) VALUES($1,'Waiting paid customer',$2)", [customer, tenant])
      await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)', [subscription, customer, tenant])
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,2,$3,$4)', [applied, subscription, { entitlement: { modules: ['webvue_platform'], features: { 'users.limit': 10 }, digest: 'c'.repeat(64), compiler_version: 1 } }, randomUUID()])
      await pool.query("UPDATE subscriptions SET applied_revision_id=$2,state='active',revision=revision+1 WHERE id=$1", [subscription, applied])
      await pool.query("INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,idempotency_key,request_digest,due_now_minor,currency,exponent) VALUES($1,$2,$3,'change',$4,$5,'paid','applied',$6,'fixture',100,'SAR',2)", [order, customer, subscription, randomUUID(), applied, randomUUID()])
    }
    let restored = false, physicalRestores = 0
    let observed: Awaited<ReturnType<ObserveRunner>> = { commercial_revision_id: older, commercial_digest: 'b'.repeat(64), branches: [] }
    const observeSubscription = vi.fn<ObserveRunner>(async input => {
      expect(input.database).toBe(restoredDatabase)
      expect(input.tenant_id).toBe(tenant)
      return observed
    })
    const adapter: SharedFencedAdapter = {
      observe: async () => restored ? { state: 'present', verified: true, binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job) } : { state: 'absent' },
      applyFenced: async ({ assertOwned }) => { await assertOwned(); physicalRestores++; restored = true },
      observeRestoreSubscription:observeSubscription,
    }
    const state = async () => (await pool.query('SELECT state,journal,receipt,lease_until FROM shared_jobs WHERE id=$1', [id])).rows[0]
    return { id, job, tenant, approval, applied, order, restoredDatabase, adapter, observeSubscription, state,
      physicalRestores: () => physicalRestores,
      current: () => { observed = { commercial_revision_id: applied, commercial_digest: 'c'.repeat(64), branches: [] } },
    }
  }

  it('after finalization requeues an older commercial restore with waiting stage rather than verified', async () => {
    const f = await fixture(true)
    expect(await runSharedJob(pool, f.id, f.adapter)).toMatchObject({ state: 'waiting_commercial_reconcile' })
    expect(await f.state()).toMatchObject({ state: 'queued', journal: { stage: 'waiting_commercial_reconcile' }, lease_until: null })
    expect((await pool.query('SELECT consumed_at FROM shared_restore_approvals WHERE id=$1', [f.approval])).rows[0].consumed_at).not.toBeNull()
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='shared_restore.completed' AND subject=$1", [f.approval])).rows[0].n).toBe(1)
    // Jobs are permanent; stop the global dispatcher from claiming this fixture's queued jobs in later tests.
    await pool.query('UPDATE tenants SET operations_enabled=false WHERE id=$1', [f.tenant])
  })

  it('skips a waiting restore while repair is queued/running and verifies it on the next claim after a fake repair receipt', async () => {
    const f = await fixture(true)
    // Isolate the dispatcher to this fixture: other files' leftover queued jobs must not be claimed.
    await pool.query('UPDATE tenants SET operations_enabled=false WHERE id<>$1', [f.tenant])
    // Seed the intended post-finalize state directly, so the separate known
    // handoff bug above cannot prevent dispatcher/readback coverage from running.
    const attemptId = randomUUID()
    const receipt = { schemaVersion: 1, operation: 'restore', binding: f.job.binding, businessKey: businessKey(f.job), payloadDigest: payloadDigest(f.job), attemptId, sequence: 3, status: 'verified' }
    await pool.query("UPDATE shared_jobs SET journal=$2,receipt=$3 WHERE id=$1", [f.id, { schemaVersion: 1, job: f.job, attemptId, sequence: 3, stage: 'waiting_commercial_reconcile' }, receipt])
    await pool.query('UPDATE shared_restore_approvals SET consumed_at=clock_timestamp() WHERE id=$1', [f.approval])
    expect(await commercialRestoreGate(pool, { tenant_id: f.tenant, restore_id: f.approval, target: { database: f.restoredDatabase, filestore: f.restoredDatabase, host: `${f.job.binding.tenantId}.restore` }, runner: f.adapter.observeRestoreSubscription })).toMatchObject({ ready: false })
    const repairs = (await pool.query("SELECT id,payload FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [f.tenant])).rows
    expect(repairs).toHaveLength(1)
    expect(repairs[0].payload).toMatchObject({ restore: true, binding: { database: f.restoredDatabase }, authority: { target_revision_id: f.applied } })

    let release!: () => void, started!: () => void
    const running = new Promise<void>(resolve => { started = resolve })
    const receiptGate = new Promise<void>(resolve => { release = resolve })
    f.adapter.subscriptionRunner = vi.fn(async ({ job, assertOwned }) => {
      expect(job.authority.order_id).toBe(f.order)
      expect(job.binding.database).toBe(f.restoredDatabase)
      await assertOwned()
      started()
      await receiptGate
      f.current()
      return { order_id: f.order, tenant_id: f.restoredDatabase, database: f.restoredDatabase, target_revision_id: f.applied,
        observed_entitlement_digest: 'c'.repeat(64), observed_at: new Date().toISOString(), branch_bindings: [], modules_installed: [] }
    })
    // Restore is older in the queue: the dispatcher must skip it and claim repair.
    const dispatched = dispatchSharedOnce(pool, f.adapter)
    try {
      await Promise.race([running, dispatched.then(() => { throw Error('dispatcher did not claim reconfigure') })])
      expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [repairs[0].id])).rows[0].state).toBe('running')
      expect(await dispatchSharedOnce(pool, f.adapter)).toEqual({ state: 'idle' })
      expect(await f.state()).toMatchObject({ state: 'queued', journal: { stage: 'waiting_commercial_reconcile' } })
    } finally { release(); await dispatched }
    expect((await pool.query('SELECT state,receipt FROM shared_jobs WHERE id=$1', [repairs[0].id])).rows[0]).toMatchObject({ state: 'verified', receipt: { target_revision_id: f.applied } })
    expect(await dispatchSharedOnce(pool, f.adapter)).toMatchObject({ state: 'verified' })
    expect(await f.state()).toMatchObject({ state: 'verified', journal: { stage: 'verified' } })
    expect((await f.state()).receipt).toEqual(receipt)
    expect(f.physicalRestores()).toBe(0)
    expect(f.adapter.subscriptionRunner).toHaveBeenCalledTimes(1)
    expect((await pool.query('SELECT consumed_at FROM shared_restore_approvals WHERE id=$1', [f.approval])).rows[0].consumed_at).not.toBeNull()
  }, 60000)

  it('never substitutes a source observer when isolated commercial observation is unavailable', async()=>{
    const f=await fixture(true)
    delete f.adapter.observeRestoreSubscription
    f.adapter.observeSubscription=f.observeSubscription
    expect(await runSharedJob(pool,f.id,f.adapter)).toMatchObject({state:'waiting_commercial_reconcile'})
    expect(f.observeSubscription).not.toHaveBeenCalled()
    expect(await f.state()).toMatchObject({state:'queued',journal:{stage:'waiting_commercial_reconcile'}})
  })

  it('verifies a legacy tenant directly without observing or queueing commercial reconciliation', async () => {
    const f = await fixture(false)
    expect(await commercialRestoreGate(pool, { tenant_id: f.tenant })).toEqual({ ready: true })
    expect(await runSharedJob(pool, f.id, f.adapter)).toMatchObject({ state: 'verified' })
    expect(await f.state()).toMatchObject({ state: 'verified', journal: { stage: 'verified' } })
    expect(f.observeSubscription).not.toHaveBeenCalled()
    expect(f.physicalRestores()).toBe(1)
    expect((await pool.query("SELECT id FROM shared_jobs WHERE control_tenant_id=$1 AND payload->>'operation'='reconfigure'", [f.tenant])).rows).toHaveLength(0)
  })
})
